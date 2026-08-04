import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocaleStore } from '../src/store.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

let workDir: string;
let localesDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-mcp-store-'));
  localesDir = path.join(workDir, 'locales');
  await fs.cp(path.join(fixturesDir, 'locales'), localesDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

async function loadStore(): Promise<LocaleStore> {
  return LocaleStore.load(localesDir);
}

describe('scanning', () => {
  it('discovers locales and keys from per-locale directories', async () => {
    const store = await loadStore();
    expect(store.locales()).toEqual(['en', 'ru', 'th']);
    expect(store.keysForLocale('en')).toContain('actions.save');
    expect(store.keysForLocale('en')).toContain('deep.deeper.value');
    expect(store.keysForLocale('en')).toContain('app.title');
  });

  it('supports flat files rooted at locale codes', async () => {
    const flatDir = path.join(workDir, 'flat');
    await fs.cp(path.join(fixturesDir, 'locales-flat'), flatDir, { recursive: true });
    const store = await LocaleStore.load(flatDir);
    expect(store.locales()).toEqual(['en', 'th']);
    expect(store.get('th', 'hello')).toMatchObject({ value: 'Hello (th)' });
  });

  it('records unparseable files as problems and keeps going', async () => {
    await fs.writeFile(path.join(localesDir, 'en', 'broken.yml'), 'en:\n  bad: [unclosed\n', 'utf8');
    const store = await loadStore();
    expect(store.problems.some((problem) => problem.includes('broken.yml'))).toBe(true);
    expect(store.get('en', 'greeting')).toBeDefined();
  });

  it('tolerates duplicate keys like Rails (last wins)', async () => {
    await fs.writeFile(path.join(localesDir, 'en', 'dup.yml'), 'en:\n  dup: First\n  dup: Second\n', 'utf8');
    const store = await loadStore();
    expect(store.problems.some((problem) => problem.includes('dup.yml'))).toBe(false);
    expect(store.get('en', 'dup')?.value).toBe('Second');
  });
});

describe('get', () => {
  it('returns leaf values with the owning file', async () => {
    const store = await loadStore();
    const hit = store.get('en', 'actions.save');
    expect(hit?.value).toBe('Save');
    expect(hit?.filePath?.endsWith(path.join('en', 'common.yml'))).toBe(true);
  });

  it('returns a subtree for intermediate keys', async () => {
    const store = await loadStore();
    const hit = store.get('en', 'actions');
    expect(hit?.value).toEqual({ save: 'Save', cancel: 'Cancel' });
    expect(hit?.filePath).toBeUndefined();
  });

  it('returns undefined for unknown keys or locales', async () => {
    const store = await loadStore();
    expect(store.get('en', 'nope')).toBeUndefined();
    expect(store.get('xx', 'actions.save')).toBeUndefined();
  });
});

describe('upsert', () => {
  it('updates an existing key in its own file and keeps comments', async () => {
    const store = await loadStore();
    const result = await store.upsert('en', 'actions.save', 'Save now');
    expect(result.created).toBe(false);
    const text = await fs.readFile(result.filePath, 'utf8');
    expect(text).toContain('# Greeting shown on the dashboard');
    expect(text).toContain('Save now');
    expect(store.get('en', 'actions.save')?.value).toBe('Save now');
  });

  it('places a new key next to the nearest existing prefix', async () => {
    const store = await loadStore();
    const result = await store.upsert('en', 'actions.publish', 'Publish');
    expect(result.filePath.endsWith(path.join('en', 'common.yml'))).toBe(true);
    expect(store.get('en', 'actions.publish')?.value).toBe('Publish');
  });

  it('creates the default file for a brand-new prefix', async () => {
    const store = await loadStore();
    const result = await store.upsert('en', 'brand.new.key', 'Fresh');
    expect(result.created).toBe(true);
    expect(result.filePath.endsWith(path.join('en', 'common.yml'))).toBe(true);
    expect(store.get('en', 'brand.new.key')?.value).toBe('Fresh');
  });

  it('creates a new locale directory for an unknown locale', async () => {
    const store = await loadStore();
    const result = await store.upsert('ms', 'greeting', 'Hello (ms)');
    expect(result.filePath.endsWith(path.join('ms', 'common.yml'))).toBe(true);
    const text = await fs.readFile(result.filePath, 'utf8');
    expect(text).toContain('ms:');
    expect(store.locales()).toContain('ms');
  });

  it('honours an explicit relative file hint', async () => {
    const store = await loadStore();
    const result = await store.upsert('en', 'custom.key', 'Custom', 'custom/deep.yml');
    expect(result.filePath.endsWith(path.join('en', 'custom', 'deep.yml'))).toBe(true);
    expect(store.get('en', 'custom.key')?.value).toBe('Custom');
  });

  it('updates JSON files and keeps JSON formatting', async () => {
    const store = await loadStore();
    const result = await store.upsert('en', 'app.title', 'Fleet 2');
    expect(result.filePath.endsWith('mobile.json')).toBe(true);
    const text = await fs.readFile(result.filePath, 'utf8');
    expect(JSON.parse(text)).toEqual({ en: { app: { title: 'Fleet 2' } } });
  });

  it('rejects empty keys', async () => {
    const store = await loadStore();
    await expect(store.upsert('en', '', 'x')).rejects.toThrow('Invalid empty key');
  });
});

describe('deleteKey', () => {
  it('removes a key and prunes empty parents', async () => {
    const store = await loadStore();
    expect(await store.deleteKey('en', 'deep.deeper.value')).toBe(true);
    expect(store.get('en', 'deep.deeper.value')).toBeUndefined();
    expect(store.get('en', 'deep')).toBeUndefined();
    const text = await fs.readFile(path.join(localesDir, 'en', 'nested', 'extra.yml'), 'utf8');
    expect(text).not.toContain('deeper');
  });

  it('keeps non-empty parents', async () => {
    const store = await loadStore();
    await store.deleteKey('en', 'actions.save');
    expect(store.get('en', 'actions.cancel')?.value).toBe('Cancel');
  });

  it('returns false for missing keys', async () => {
    const store = await loadStore();
    expect(await store.deleteKey('en', 'nope')).toBe(false);
  });

  it('removes keys from JSON files', async () => {
    const store = await loadStore();
    expect(await store.deleteKey('en', 'app.title')).toBe(true);
    const text = await fs.readFile(path.join(localesDir, 'en', 'mobile.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({ en: {} });
  });
});
