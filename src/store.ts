import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Document, isMap, parseDocument } from 'yaml';
import { flatten, isPlainObject, splitKey } from './keys.js';

export type FileFormat = 'yaml' | 'json';

interface FileEntry {
  filePath: string;
  format: FileFormat;
  yamlDoc?: Document;
  /** Parsed content rooted at locale codes, e.g. `{ en: { ... } }`. */
  data: Record<string, unknown>;
  locales: string[];
}

export interface UpsertResult {
  filePath: string;
  created: boolean;
}

const LOCALE_EXTENSIONS = new Set(['.yml', '.yaml', '.json']);

function formatFor(filePath: string): FileFormat {
  return path.extname(filePath).toLowerCase() === '.json' ? 'json' : 'yaml';
}

/**
 * Loads Rails-style locale files from a directory tree and keeps an index of
 * which file each translation key lives in. Supports two layouts:
 *
 * - `<root>/<locale>/**\/*.yml` (per-locale directories, possibly nested)
 * - `<root>/*.yml` (flat files whose top-level keys are locale codes)
 *
 * All writes go through the store so the on-disk file and the index stay in
 * sync. YAML files are mutated through the `yaml` AST so existing comments
 * and ordering survive appends.
 */
export class LocaleStore {
  readonly rootDir: string;
  readonly problems: string[] = [];

  private readonly defaultFileName?: string;
  private files = new Map<string, FileEntry>();
  /** locale -> key path -> file path */
  private index = new Map<string, Map<string, string>>();

  private constructor(rootDir: string, defaultFileName?: string) {
    this.rootDir = rootDir;
    this.defaultFileName = defaultFileName;
  }

  static async load(rootDir: string, defaultFileName?: string): Promise<LocaleStore> {
    const store = new LocaleStore(rootDir, defaultFileName);
    await store.reload();
    return store;
  }

  /** Rescan the locales directory from disk, dropping all cached state. */
  async reload(): Promise<void> {
    this.files.clear();
    this.index.clear();
    this.problems.length = 0;

    const filePaths = await this.scanFiles();
    for (const filePath of filePaths) {
      await this.parseFile(filePath);
    }
    for (const entry of this.files.values()) {
      this.reindex(entry);
    }
  }

  locales(): string[] {
    return [...this.index.keys()].sort();
  }

  filesForLocale(locale: string): string[] {
    return [...this.files.values()]
      .filter((entry) => entry.locales.includes(locale))
      .map((entry) => entry.filePath)
      .sort();
  }

  /** All key paths known in any locale, sorted. */
  allKeys(): string[] {
    const keys = new Set<string>();
    for (const localeIndex of this.index.values()) {
      for (const key of localeIndex.keys()) {
        keys.add(key);
      }
    }
    return [...keys].sort();
  }

  keysForLocale(locale: string): string[] {
    const localeIndex = this.index.get(locale);
    return localeIndex ? [...localeIndex.keys()].sort() : [];
  }

  /**
   * Look up a key in a locale. Returns the leaf value, or a subtree object
   * when the key is an intermediate path. `filePath` is only set for leaves.
   */
  get(locale: string, key: string): { value: unknown; filePath?: string } | undefined {
    const localeIndex = this.index.get(locale);
    if (!localeIndex) {
      return undefined;
    }
    const filePath = localeIndex.get(key);
    if (filePath) {
      const entry = this.files.get(filePath);
      if (entry) {
        return { value: this.valueAt(entry, locale, splitKey(key)), filePath };
      }
    }
    const prefix = `${key}.`;
    const children = [...localeIndex.entries()].filter(([candidate]) => candidate.startsWith(prefix));
    if (children.length === 0) {
      return undefined;
    }
    const subtree: Record<string, unknown> = {};
    for (const [childKey, childFile] of children) {
      const entry = this.files.get(childFile);
      if (!entry) {
        continue;
      }
      const value = this.valueAt(entry, locale, splitKey(childKey));
      this.setDeep(subtree, splitKey(childKey.slice(prefix.length)), value);
    }
    return { value: subtree };
  }

  hasLocale(locale: string): boolean {
    return this.index.has(locale);
  }

  /**
   * Create or update a key in a locale. Placement: the file the key already
   * lives in, else the file holding the nearest existing key prefix, else
   * `fileHint`, else the default file for the locale.
   */
  async upsert(locale: string, key: string, value: unknown, fileHint?: string): Promise<UpsertResult> {
    const segments = splitKey(key);
    if (segments.length === 0) {
      throw new Error(`Invalid empty key for locale "${locale}"`);
    }
    const existing = this.index.get(locale)?.get(key);
    const filePath = existing ?? this.pickFileFor(locale, segments, fileHint);
    const entry = await this.ensureFile(filePath, locale);
    const fullPath = [locale, ...segments];

    if (entry.format === 'yaml') {
      if (!entry.yamlDoc) {
        throw new Error(`Internal error: missing YAML document for ${filePath}`);
      }
      entry.yamlDoc.setIn(fullPath, value);
      entry.data = this.documentData(entry.yamlDoc, filePath);
    } else {
      this.setDeep(entry.data, fullPath, value);
    }

    await this.writeFile(entry);
    this.reindex(entry);
    return { filePath, created: !existing };
  }

  /** Delete a key from a locale, pruning now-empty parent maps. Returns false when absent. */
  async deleteKey(locale: string, key: string): Promise<boolean> {
    const filePath = this.index.get(locale)?.get(key);
    if (!filePath) {
      return false;
    }
    const entry = this.files.get(filePath);
    if (!entry) {
      return false;
    }
    const segments = splitKey(key);

    if (entry.format === 'yaml') {
      if (!entry.yamlDoc) {
        throw new Error(`Internal error: missing YAML document for ${filePath}`);
      }
      entry.yamlDoc.deleteIn([locale, ...segments]);
      this.pruneYaml(entry.yamlDoc, locale, segments);
      entry.data = this.documentData(entry.yamlDoc, filePath);
    } else {
      this.deleteDeep(entry.data, [locale, ...segments]);
    }

    await this.writeFile(entry);
    this.reindex(entry);
    return true;
  }

  // --- internal -----------------------------------------------------------

  private async scanFiles(): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let dirents;
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        const full = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          await walk(full);
        } else if (dirent.isFile() && LOCALE_EXTENSIONS.has(path.extname(dirent.name).toLowerCase())) {
          found.push(full);
        }
      }
    };
    await walk(this.rootDir);
    return found.sort();
  }

  private async parseFile(filePath: string): Promise<void> {
    const format = formatFor(filePath);
    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      this.problems.push(`Cannot read ${filePath}: ${(error as Error).message}`);
      return;
    }

    if (text.trim().length === 0) {
      return;
    }

    if (format === 'json') {
      try {
        const data: unknown = JSON.parse(text);
        if (!isPlainObject(data)) {
          this.problems.push(`Skipping ${filePath}: top level must be an object of locale codes`);
          return;
        }
        this.files.set(filePath, { filePath, format, data, locales: Object.keys(data) });
      } catch (error) {
        this.problems.push(`Cannot parse ${filePath}: ${(error as Error).message}`);
      }
      return;
    }

    // Rails (Psych) tolerates duplicate keys with last-wins; match that.
    const doc = parseDocument(text, { uniqueKeys: false });
    if (doc.errors.length > 0) {
      const first = doc.errors[0];
      this.problems.push(`Cannot parse ${filePath}: ${first ? first.message : 'unknown YAML error'}`);
      return;
    }
    try {
      const data = this.documentData(doc, filePath);
      this.files.set(filePath, { filePath, format, yamlDoc: doc, data, locales: Object.keys(data) });
    } catch (error) {
      this.problems.push(`Skipping ${filePath}: ${(error as Error).message}`);
    }
  }

  private documentData(doc: Document, filePath: string): Record<string, unknown> {
    const data: unknown = doc.toJS();
    if (!isPlainObject(data)) {
      throw new Error(`Locale file ${filePath} must map locale codes to translations`);
    }
    return data;
  }

  private reindex(entry: FileEntry): void {
    for (const localeIndex of this.index.values()) {
      for (const [key, file] of localeIndex) {
        if (file === entry.filePath) {
          localeIndex.delete(key);
        }
      }
    }
    for (const locale of Object.keys(entry.data)) {
      let localeIndex = this.index.get(locale);
      if (!localeIndex) {
        localeIndex = new Map();
        this.index.set(locale, localeIndex);
      }
      for (const key of flatten(entry.data[locale]).keys()) {
        if (!localeIndex.has(key)) {
          localeIndex.set(key, entry.filePath);
        }
      }
    }
    for (const [locale, localeIndex] of this.index) {
      if (localeIndex.size === 0) {
        this.index.delete(locale);
      }
    }
  }

  private valueAt(entry: FileEntry, locale: string, segments: string[]): unknown {
    let node: unknown = entry.data[locale];
    for (const segment of segments) {
      if (!isPlainObject(node)) {
        return undefined;
      }
      node = node[segment];
    }
    return node;
  }

  private pickFileFor(locale: string, segments: string[], fileHint?: string): string {
    const localeIndex = this.index.get(locale);
    if (localeIndex) {
      for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
        const prefix = segments.slice(0, depth).join('.');
        const dotted = `${prefix}.`;
        for (const [key, file] of localeIndex) {
          if (key === prefix || key.startsWith(dotted)) {
            return file;
          }
        }
      }
    }

    if (fileHint) {
      return path.isAbsolute(fileHint) ? fileHint : path.join(this.localeDir(locale), fileHint);
    }

    const name = this.defaultFileName ?? this.defaultNameFor(locale);
    return path.join(this.localeDir(locale), name);
  }

  private localeDir(locale: string): string {
    const dir = path.join(this.rootDir, locale);
    const hasLocaleDir = this.filesForLocale(locale).some((file) => path.dirname(file).startsWith(dir));
    if (hasLocaleDir) {
      return dir;
    }
    // New locale: follow the layout other locales use. If any locale keeps
    // its files in a directory named after the locale, do the same.
    const usesLocaleDirs = [...this.files.values()].some((entry) =>
      entry.locales.some((other) => path.dirname(entry.filePath).startsWith(path.join(this.rootDir, other))),
    );
    return usesLocaleDirs || this.files.size === 0 ? dir : this.rootDir;
  }

  private defaultNameFor(locale: string): string {
    const existing = this.filesForLocale(locale);
    const format = existing.some((file) => formatFor(file) === 'json') && !existing.some((file) => formatFor(file) === 'yaml')
      ? 'json'
      : 'yaml';
    return format === 'json' ? 'common.json' : 'common.yml';
  }

  private async ensureFile(filePath: string, locale: string): Promise<FileEntry> {
    const existing = this.files.get(filePath);
    if (existing) {
      if (!existing.locales.includes(locale)) {
        throw new Error(`File ${filePath} does not contain locale "${locale}"`);
      }
      return existing;
    }
    const format = formatFor(filePath);
    const data: Record<string, unknown> = { [locale]: {} };
    const entry: FileEntry = { filePath, format, data, locales: [locale] };
    if (format === 'yaml') {
      entry.yamlDoc = new Document(data);
    }
    this.files.set(filePath, entry);
    return entry;
  }

  private async writeFile(entry: FileEntry): Promise<void> {
    await fs.mkdir(path.dirname(entry.filePath), { recursive: true });
    if (entry.format === 'yaml') {
      if (!entry.yamlDoc) {
        throw new Error(`Internal error: missing YAML document for ${entry.filePath}`);
      }
      await fs.writeFile(entry.filePath, entry.yamlDoc.toString(), 'utf8');
    } else {
      await fs.writeFile(entry.filePath, `${JSON.stringify(entry.data, null, 2)}\n`, 'utf8');
    }
  }

  private setDeep(target: Record<string, unknown>, segments: string[], value: unknown): void {
    let node = target;
    for (const segment of segments.slice(0, -1)) {
      const next = node[segment];
      if (isPlainObject(next)) {
        node = next;
      } else {
        const created: Record<string, unknown> = {};
        node[segment] = created;
        node = created;
      }
    }
    const last = segments[segments.length - 1];
    if (last !== undefined) {
      node[last] = value;
    }
  }

  private deleteDeep(target: Record<string, unknown>, segments: string[]): void {
    const chain: Record<string, unknown>[] = [];
    let node: unknown = target;
    for (const segment of segments.slice(0, -1)) {
      if (!isPlainObject(node)) {
        return;
      }
      chain.push(node);
      node = node[segment];
    }
    if (!isPlainObject(node)) {
      return;
    }
    const last = segments[segments.length - 1];
    if (last !== undefined) {
      delete node[last];
    }
    // Prune empty parents, but never the locale root (segments[0]).
    for (let depth = segments.length - 1; depth >= 2; depth -= 1) {
      const parent = chain[depth - 1];
      const child = parent?.[segments[depth - 1] ?? ''];
      if (isPlainObject(child) && Object.keys(child).length === 0) {
        delete parent?.[segments[depth - 1] ?? ''];
      } else {
        break;
      }
    }
  }

  private pruneYaml(doc: Document, locale: string, segments: string[]): void {
    for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
      const parentPath = [locale, ...segments.slice(0, depth)];
      const node = doc.getIn(parentPath, true);
      if (isMap(node) && node.items.length === 0) {
        doc.deleteIn(parentPath);
      } else {
        break;
      }
    }
  }
}
