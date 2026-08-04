import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { extractPlaceholders } from '../keys.js';
import type { LocaleStore } from '../store.js';
import { fail, ok } from './common.js';

/** Compare `%{placeholder}` usage of a key across all known locales. */
export function placeholderWarnings(store: LocaleStore, key: string): string[] {
  const perLocale = new Map<string, string[]>();
  for (const locale of store.locales()) {
    const hit = store.get(locale, key);
    if (hit !== undefined) {
      perLocale.set(locale, extractPlaceholders(hit.value));
    }
  }
  const union = new Set<string>();
  for (const names of perLocale.values()) {
    for (const name of names) {
      union.add(name);
    }
  }
  const warnings: string[] = [];
  for (const [locale, names] of perLocale) {
    const missing = [...union].filter((name) => !names.includes(name));
    if (missing.length > 0) {
      warnings.push(`Locale "${locale}" is missing placeholder(s): ${missing.join(', ')}`);
    }
  }
  return warnings.sort();
}

export async function handleUpsertTranslation(
  store: LocaleStore,
  args: { key: string; values: Record<string, string>; file?: string },
): Promise<CallToolResult> {
  const locales = Object.keys(args.values);
  if (locales.length === 0) {
    return fail('Provide at least one locale value');
  }
  const updated: Record<string, { file: string; created: boolean }> = {};
  try {
    for (const [locale, value] of Object.entries(args.values)) {
      const result = await store.upsert(locale, args.key, value, args.file);
      updated[locale] = { file: result.filePath, created: result.created };
    }
  } catch (error) {
    return fail(`Failed to write "${args.key}": ${(error as Error).message}`);
  }
  return ok({ key: args.key, updated, warnings: placeholderWarnings(store, args.key) });
}

export async function handleDeleteKey(
  store: LocaleStore,
  args: { key: string; locales?: string[] },
): Promise<CallToolResult> {
  const locales = args.locales ?? store.locales();
  for (const locale of locales) {
    if (!store.hasLocale(locale)) {
      return fail(`Unknown locale "${locale}". Available: ${store.locales().join(', ')}`);
    }
  }
  const deleted: Record<string, boolean> = {};
  try {
    for (const locale of locales) {
      deleted[locale] = await store.deleteKey(locale, args.key);
    }
  } catch (error) {
    return fail(`Failed to delete "${args.key}": ${(error as Error).message}`);
  }
  if (Object.values(deleted).every((value) => !value)) {
    return fail(`Key "${args.key}" not found in any of: ${locales.join(', ')}`);
  }
  return ok({ key: args.key, deleted });
}

export function registerWriteTools(server: McpServer, store: LocaleStore): void {
  server.registerTool(
    'set_key',
    {
      description:
        "Create or update a key per locale. Writes to the key's current file, the nearest " +
        "prefix's file, or the locale default. Warns on %{placeholder} mismatch.",
      inputSchema: {
        key: z.string().describe('Dot-separated key path, e.g. "roles_scope.super_admin"'),
        values: z.record(z.string(), z.string()).describe('Locale code → translation'),
        file: z.string().optional().describe('Target file (absolute, or relative to the locale dir)'),
      },
    },
    (args) => handleUpsertTranslation(store, args),
  );

  server.registerTool(
    'delete_key',
    {
      description: 'Delete a key from locales (default: all); prunes empty parents.',
      inputSchema: {
        key: z.string().describe('Dot-separated key path, e.g. "roles_scope.super_admin"'),
        locales: z.array(z.string()).optional().describe('Default: all locales'),
      },
    },
    (args) => handleDeleteKey(store, args),
  );
}
