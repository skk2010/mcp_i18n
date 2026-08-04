import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { extractPlaceholders, isEmptyValue } from '../keys.js';
import type { LocaleStore } from '../store.js';
import { fail, ok } from './common.js';

interface MissingIssue {
  key: string;
  missingIn: string[];
  emptyIn: string[];
  placeholderMismatch: Array<{ locale: string; missing: string[] }>;
}

export function handleCheckMissing(
  store: LocaleStore,
  args: { baseLocale?: string; prefix?: string; limit?: number },
): CallToolResult {
  const locales = store.locales();
  if (locales.length === 0) {
    return fail(`No locales found under ${store.rootDir}`);
  }
  const baseLocale = args.baseLocale ?? (locales.includes('en') ? 'en' : locales[0]);
  if (baseLocale === undefined || !store.hasLocale(baseLocale)) {
    return fail(`Unknown base locale "${args.baseLocale ?? ''}". Available: ${locales.join(', ')}`);
  }
  const limit = args.limit ?? 100;

  let keys = store.allKeys();
  if (args.prefix !== undefined) {
    const prefix = args.prefix;
    keys = keys.filter((key) => key === prefix || key.startsWith(`${prefix}.`));
  }

  const issues: MissingIssue[] = [];
  let missingCount = 0;
  let emptyCount = 0;
  let placeholderCount = 0;

  for (const key of keys) {
    const missingIn: string[] = [];
    const emptyIn: string[] = [];
    const placeholderMismatch: Array<{ locale: string; missing: string[] }> = [];
    const baseHit = store.get(baseLocale, key);
    const basePlaceholders = baseHit !== undefined ? extractPlaceholders(baseHit.value) : [];

    for (const locale of locales) {
      const hit = store.get(locale, key);
      if (hit === undefined) {
        missingIn.push(locale);
        continue;
      }
      if (isEmptyValue(hit.value)) {
        emptyIn.push(locale);
      }
      if (locale !== baseLocale && basePlaceholders.length > 0) {
        const names = extractPlaceholders(hit.value);
        const missing = basePlaceholders.filter((name) => !names.includes(name));
        if (missing.length > 0) {
          placeholderMismatch.push({ locale, missing });
        }
      }
    }

    if (missingIn.length > 0 || emptyIn.length > 0 || placeholderMismatch.length > 0) {
      missingCount += missingIn.length;
      emptyCount += emptyIn.length;
      placeholderCount += placeholderMismatch.length;
      if (issues.length < limit) {
        issues.push({ key, missingIn, emptyIn, placeholderMismatch });
      }
    }
  }

  return ok({
    baseLocale,
    locales,
    totals: {
      keysChecked: keys.length,
      missing: missingCount,
      empty: emptyCount,
      placeholderMismatches: placeholderCount,
    },
    issues,
  });
}

export function registerCheckTools(server: McpServer, store: LocaleStore): void {
  server.registerTool(
    'missing',
    {
      description:
        'Audit keys: missing per locale, empty values, %{placeholder} mismatches vs base locale (default: en).',
      inputSchema: {
        baseLocale: z.string().optional().describe('Reference locale (default: en)'),
        prefix: z.string().optional().describe('Only keys at/below this prefix'),
        limit: z.number().int().positive().optional().describe('Max issues (default 100)'),
      },
    },
    (args) => handleCheckMissing(store, args),
  );
}
