# i18n-mcp

An MCP (Model Context Protocol) server that gives coding agents tools to manage
Rails-style localization files (YAML or JSON). Point it at a Rails app's
`config/locales` directory and the agent can read, search, write and audit
translations without hand-editing files.

## Supported layouts

Both common Rails layouts are detected automatically, and can be mixed:

```
config/locales/
  en/                  # per-locale directories (nesting allowed)
    common.yml         # rooted at the locale code: `en: ...`
    admin/users.yml
  th/common.yml
  legacy.yml           # flat files whose top-level keys are locale codes
```

Files may be `.yml`, `.yaml` or `.json`. Writes go through the YAML AST, so
existing comments and key order survive edits. Duplicate keys are tolerated
with last-wins semantics, matching Rails (Psych). Files that cannot be parsed
are reported in `locales` output under `problems` instead of aborting
the server.

## Install and build

```sh
npm install
npm run build
```

## Usage with an MCP client

Add the server to your MCP client configuration (Kimi Code, Claude Desktop,
etc.), passing the Rails app's locales directory:

```json
{
  "mcpServers": {
    "i18n": {
      "command": "node",
      "args": [
        "/path/to/i18n-mcp/dist/src/index.js",
        "--locales-dir", "/path/to/rails-app/config/locales"
      ]
    }
  }
}
```

Options:

- `--locales-dir <path>` — locales directory. Falls back to the
  `I18N_LOCALES_DIR` environment variable, then `<cwd>/config/locales`.
- `--default-file <name>` — file name (relative to the locale directory) for
  brand-new keys. Default: `common.yml` (or `common.json` for JSON-only
  locales).

## Tools

| Tool | Description |
| --- | --- |
| `locales` | List locales with file/key counts and parse problems. |
| `keys` | List translation key paths; filter by `locale` and/or `prefix`. |
| `get_key` | Get a key's values across locales, with the file each lives in. |
| `search` | Substring search over translation keys (optionally values). |
| `set_key` | Create or update a key per locale. Writes to the key's current file, the nearest prefix's file, or the locale default. Warns on `%{placeholder}` mismatch. |
| `delete_key` | Delete a key from locales (default: all); prunes empty parents. |
| `missing` | Audit keys: missing per locale, empty values, `%{placeholder}` mismatches vs base locale (default `en`). |

### Examples

```jsonc
// get_key
{ "key": "roles_scope.super_admin" }

// set_key
{ "key": "features.reports.title", "values": { "en": "Reports", "th": "Reports (th)" } }

// missing, scoped to one subtree
{ "prefix": "dashboards", "limit": 50 }
```

All responses are JSON. Errors (unknown locale, missing key, write failures)
are returned as tool errors with a human-readable message.

## Development

```sh
npm test            # vitest unit/handler tests
npm run coverage    # tests + v8 coverage report (enforced thresholds: 85% lines/statements, 80% branches/functions)
npm run lint        # eslint (zero errors required)
npm run typecheck   # tsc --noEmit, strict (zero errors required)
npm run build       # compile to dist/
npm run smoke       # end-to-end test over real stdio transport
```
