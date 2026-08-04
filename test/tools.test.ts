import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocaleStore } from '../src/store.js';
import { handleCheckMissing } from '../src/tools/check.js';
import {
  handleGetTranslation,
  handleListKeys,
  handleListLocales,
  handleSearchKeys,
} from '../src/tools/read.js';
import { handleDeleteKey, handleUpsertTranslation, placeholderWarnings } from '../src/tools/write.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

let workDir: string;
let store: LocaleStore;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-mcp-tools-'));
  await fs.cp(path.join(fixturesDir, 'locales'), path.join(workDir, 'locales'), { recursive: true });
  store = await LocaleStore.load(path.join(workDir, 'locales'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

function payload(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  if (result.isError === true || content?.type !== 'text') {
    throw new Error(`Expected success payload, got: ${JSON.stringify(result.content)}`);
  }
  return JSON.parse(content.text) as Record<string, unknown>;
}

function errorText(result: CallToolResult): string {
  const content = result.content[0];
  if (result.isError !== true || content?.type !== 'text') {
    throw new Error('Expected an error result');
  }
  return content.text;
}

describe('locales', () => {
  it('lists locales with counts', () => {
    const data = payload(handleListLocales(store));
    const codes = (data['locales'] as Array<{ code: string }>).map((entry) => entry.code);
    expect(codes).toEqual(['en', 'ru', 'th']);
  });
});

describe('keys', () => {
  it('lists all keys and filters by prefix and locale', () => {
    const all = payload(handleListKeys(store, {}));
    expect(all['total']).toBeGreaterThan(0);

    const filtered = payload(handleListKeys(store, { prefix: 'actions', locale: 'en' }));
    expect(filtered['keys']).toEqual(['actions.cancel', 'actions.save']);
  });

  it('rejects unknown locales', () => {
    expect(errorText(handleListKeys(store, { locale: 'xx' }))).toContain('Unknown locale');
  });
});

describe('get_key', () => {
  it('returns values per locale and reports missing ones', () => {
    const data = payload(handleGetTranslation(store, { key: 'actions.cancel' }));
    const translations = data['translations'] as Record<string, { value: string }>;
    expect(translations['en']?.value).toBe('Cancel');
    expect(data['missing']).toEqual(['th']);
  });

  it('fails when the key exists nowhere', () => {
    expect(errorText(handleGetTranslation(store, { key: 'nope' }))).toContain('not found');
  });
});

describe('search', () => {
  it('matches keys by substring', () => {
    const data = payload(handleSearchKeys(store, { query: 'save', locale: 'en' }));
    const keys = (data['matches'] as Array<{ key: string }>).map((match) => match.key);
    expect(keys).toContain('actions.save');
  });

  it('matches values when searchValues is set', () => {
    const data = payload(handleSearchKeys(store, { query: 'deep value', searchValues: true }));
    expect(data['total']).toBe(1);
  });
});

describe('set_key', () => {
  it('writes multiple locales and returns file info', async () => {
    const result = await handleUpsertTranslation(store, {
      key: 'features.new.title',
      values: { en: 'New feature', th: 'New feature (th)' },
    });
    const data = payload(result);
    const updated = data['updated'] as Record<string, { file: string }>;
    expect(updated['en']?.file.endsWith(path.join('en', 'common.yml'))).toBe(true);
    expect(store.get('th', 'features.new.title')?.value).toBe('New feature (th)');
  });

  it('warns about placeholder mismatches', async () => {
    await handleUpsertTranslation(store, {
      key: 'greeting',
      values: { en: 'Hello %{name}', th: 'Hello' },
    });
    const warnings = placeholderWarnings(store, 'greeting');
    expect(warnings.some((warning) => warning.includes('"th"') && warning.includes('name'))).toBe(true);
  });

  it('rejects empty value maps', async () => {
    const result = await handleUpsertTranslation(store, { key: 'a', values: {} });
    expect(errorText(result)).toContain('at least one locale');
  });
});

describe('delete_key', () => {
  it('deletes from all locales by default', async () => {
    const result = await handleDeleteKey(store, { key: 'actions.cancel' });
    const data = payload(result);
    expect(data['deleted']).toMatchObject({ en: true, ru: true, th: false });
    expect(store.get('en', 'actions.cancel')).toBeUndefined();
  });

  it('fails when the key exists nowhere', async () => {
    expect(errorText(await handleDeleteKey(store, { key: 'nope' }))).toContain('not found');
  });
});

describe('missing', () => {
  it('reports missing, empty and placeholder mismatches', () => {
    const data = payload(handleCheckMissing(store, {}));
    expect(data['baseLocale']).toBe('en');
    const issues = data['issues'] as Array<{
      key: string;
      missingIn: string[];
      emptyIn: string[];
      placeholderMismatch: Array<{ locale: string }>;
    }>;
    const cancel = issues.find((issue) => issue.key === 'actions.cancel');
    expect(cancel?.missingIn).toEqual(['th']);
    const greeting = issues.find((issue) => issue.key === 'greeting');
    expect(greeting?.emptyIn).toEqual(['th']);
    expect(greeting?.placeholderMismatch.map((entry) => entry.locale)).toEqual(['th']);
  });

  it('scopes checks to a prefix', () => {
    const data = payload(handleCheckMissing(store, { prefix: 'deep' }));
    const totals = data['totals'] as { keysChecked: number };
    expect(totals.keysChecked).toBe(1);
  });

  it('rejects an unknown base locale', () => {
    expect(errorText(handleCheckMissing(store, { baseLocale: 'xx' }))).toContain('Unknown base locale');
  });
});
