/**
 * Smoke test: spawns the built server over real stdio transport and
 * round-trips upsert -> get -> delete against a temp copy of the fixtures.
 *
 * Run with `npm run smoke` (builds first). Exits non-zero on failure.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Compiled to dist/test/smoke.js, so the project root is two levels up.
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Smoke test failed: ${message}`);
  }
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const first = content?.[0];
  return first?.type === 'text' && first.text !== undefined ? first.text : JSON.stringify(result);
}

async function main(): Promise<void> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-mcp-smoke-'));
  const localesDir = path.join(workDir, 'locales');
  await fs.cp(path.join(projectRoot, 'test', 'fixtures', 'locales'), localesDir, { recursive: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'dist', 'src', 'index.js'), '--locales-dir', localesDir],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'i18n-mcp-smoke', version: '0.1.0' });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert(names.length === 7, `expected 7 tools, got ${names.join(', ')}`);
    for (const expected of [
      'delete_key',
      'get_key',
      'keys',
      'locales',
      'missing',
      'search',
      'set_key',
    ]) {
      assert(names.includes(expected), `missing tool ${expected}`);
    }

    const upsert = await client.callTool({
      name: 'set_key',
      arguments: { key: 'smoke.test', values: { en: 'Smoke %{who}', th: 'Smoke (th)' } },
    });
    assert(textOf(upsert).includes('smoke.test'), 'upsert did not report the key');

    const get = await client.callTool({ name: 'get_key', arguments: { key: 'smoke.test' } });
    assert(textOf(get).includes('Smoke %{who}'), 'get did not return the upserted value');

    const check = await client.callTool({ name: 'missing', arguments: {} });
    assert(textOf(check).includes('placeholderMismatches'), 'missing output unexpected');

    const remove = await client.callTool({ name: 'delete_key', arguments: { key: 'smoke.test' } });
    assert(textOf(remove).includes('"en": true'), 'delete did not report success');

    const after = await client.callTool({ name: 'get_key', arguments: { key: 'smoke.test' } });
    assert((after as { isError?: boolean }).isError === true, 'key still present after delete');

    console.log('Smoke test passed: 7 tools listed, upsert/get/check/delete round-trip OK.');
  } finally {
    await client.close();
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
