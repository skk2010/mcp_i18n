#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveConfig } from './config.js';
import { LocaleStore } from './store.js';
import { registerCheckTools } from './tools/check.js';
import { registerReadTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';

async function main(): Promise<void> {
  const config = await resolveConfig(process.argv.slice(2));
  const store = await LocaleStore.load(config.localesDir, config.defaultFile);

  const server = new McpServer({
    name: 'i18n-mcp',
    version: '0.1.0',
  });

  registerReadTools(server, store);
  registerWriteTools(server, store);
  registerCheckTools(server, store);

  await server.connect(new StdioServerTransport());
  console.error(`i18n-mcp serving ${store.locales().length} locale(s) from ${config.localesDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
