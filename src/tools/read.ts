import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { LocaleStore } from '../store.js';
import { fail, ok } from './common.js';

export function handleListLocales(store: LocaleStore): CallToolResult {
  const locales = store.locales().map((code) => ({
    code,
    files: store.filesForLocale(code).length,
    keys: store.keysForLocale(code).length,
  }));
  return ok({ locales, problems: store.problems });
}

export function handleListKeys(
  store: LocaleStore,
  args: { prefix?: string; locale?: string; limit?: number },
): CallToolResult {
  if (args.locale !== undefined && !store.hasLocale(args.locale)) {
    return fail(`Unknown locale "${args.locale}". Available: ${store.locales().join(', ')}`);
  }
  const limit = args.limit ?? 200;
  let keys = args.locale !== undefined ? store.keysForLocale(args.locale) : store.allKeys();
  if (args.prefix !== undefined) {
    const prefix = args.prefix;
    keys = keys.filter((key) => key === prefix || key.startsWith(`${prefix}.`));
  }
  return ok({ keys: keys.slice(0, limit), total: keys.length });
}

export function handleGetTranslation(
  store: LocaleStore,
  args: { key: string; locales?: string[] },
): CallToolResult {
  const locales = args.locales ?? store.locales();
  for (const locale of locales) {
    if (!store.hasLocale(locale)) {
      return fail(`Unknown locale "${locale}". Available: ${store.locales().join(', ')}`);
    }
  }
  const translations: Record<string, { value: unknown; file?: string }> = {};
  const missing: string[] = [];
  for (const locale of locales) {
    const hit = store.get(locale, args.key);
    if (hit === undefined) {
      missing.push(locale);
    } else {
      translations[locale] = hit.filePath !== undefined
        ? { value: hit.value, file: hit.filePath }
        : { value: hit.value };
    }
  }
  if (missing.length === locales.length) {
    return fail(`Key "${args.key}" not found in any locale`);
  }
  return ok({ key: args.key, translations, missing });
}

export function handleSearchKeys(
  store: LocaleStore,
  args: { query: string; locale?: string; searchValues?: boolean; limit?: number },
): CallToolResult {
  if (args.locale !== undefined && !store.hasLocale(args.locale)) {
    return fail(`Unknown locale "${args.locale}". Available: ${store.locales().join(', ')}`);
  }
  const limit = args.limit ?? 50;
  const needle = args.query.toLowerCase();
  const locales = args.locale !== undefined ? [args.locale] : store.locales();
  const matches: Array<{ locale: string; key: string; value: unknown; file?: string }> = [];
  let total = 0;

  for (const locale of locales) {
    for (const key of store.keysForLocale(locale)) {
      const hit = store.get(locale, key);
      if (hit === undefined) {
        continue;
      }
      const inKey = key.toLowerCase().includes(needle);
      const inValue = args.searchValues === true && typeof hit.value === 'string'
        && hit.value.toLowerCase().includes(needle);
      if (inKey || inValue) {
        total += 1;
        if (matches.length < limit) {
          matches.push(hit.filePath !== undefined
            ? { locale, key, value: hit.value, file: hit.filePath }
            : { locale, key, value: hit.value });
        }
      }
    }
  }
  return ok({ matches, total });
}

export function registerReadTools(server: McpServer, store: LocaleStore): void {
  server.registerTool(
    'locales',
    {
      description: 'List locales with file/key counts and parse problems.',
      inputSchema: {},
    },
    () => handleListLocales(store),
  );

  server.registerTool(
    'keys',
    {
      description: 'List translation key paths; filter by locale and/or prefix.',
      inputSchema: {
        prefix: z.string().optional().describe('Only keys at/below this prefix'),
        locale: z.string().optional().describe('Only this locale'),
        limit: z.number().int().positive().optional().describe('Max results (default 200)'),
      },
    },
    (args) => handleListKeys(store, args),
  );

  server.registerTool(
    'get_key',
    {
      description: "Get a key's values across locales, with the file each lives in.",
      inputSchema: {
        key: z.string().describe('Dot-separated key path, e.g. "roles_scope.super_admin"'),
        locales: z.array(z.string()).optional().describe('Default: all locales'),
      },
    },
    (args) => handleGetTranslation(store, args),
  );

  server.registerTool(
    'search',
    {
      description: 'Substring search over translation keys (optionally values).',
      inputSchema: {
        query: z.string().describe('Substring to find'),
        locale: z.string().optional().describe('Only this locale'),
        searchValues: z.boolean().optional().describe('Also match values'),
        limit: z.number().int().positive().optional().describe('Max results (default 50)'),
      },
    },
    (args) => handleSearchKeys(store, args),
  );
}
