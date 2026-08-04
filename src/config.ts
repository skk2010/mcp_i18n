import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ServerConfig {
  localesDir: string;
  defaultFile?: string;
}

const USAGE = `Usage: i18n-mcp [--locales-dir <path>] [--default-file <name>]

Options:
  --locales-dir <path>   Directory with locale files (default: $I18N_LOCALES_DIR or <cwd>/config/locales)
  --default-file <name>  File name for brand-new keys (default: common.yml / common.json)
`;

/**
 * Resolve the server configuration from CLI args, environment and cwd.
 * Throws with a clear message when the locales directory cannot be found.
 */
export async function resolveConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<ServerConfig> {
  let localesDir: string | undefined;
  let defaultFile: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--locales-dir') {
      localesDir = argv[++i];
    } else if (arg === '--default-file') {
      defaultFile = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      throw new Error(USAGE);
    } else if (arg !== undefined) {
      throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }

  const rawDir = localesDir ?? env['I18N_LOCALES_DIR'] ?? path.join(cwd, 'config', 'locales');
  const resolved = path.resolve(cwd, rawDir);

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(
      `Locales directory not found: ${resolved}\nPass --locales-dir <path> or set I18N_LOCALES_DIR.`,
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(`Locales path is not a directory: ${resolved}`);
  }

  return defaultFile !== undefined ? { localesDir: resolved, defaultFile } : { localesDir: resolved };
}
