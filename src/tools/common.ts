import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Successful tool response carrying a JSON payload. */
export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: isRecord(data) ? data : { result: data },
  } as CallToolResult;
}

/** Error tool response; never throws across the transport. */
export function fail(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
