import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-mcp-config-'));
  await fs.mkdir(path.join(workDir, 'config', 'locales'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('resolveConfig', () => {
  it('prefers the --locales-dir argument', async () => {
    const custom = path.join(workDir, 'custom');
    await fs.mkdir(custom);
    const config = await resolveConfig(['--locales-dir', custom], {}, workDir);
    expect(config.localesDir).toBe(custom);
  });

  it('resolves relative --locales-dir against cwd', async () => {
    const config = await resolveConfig(['--locales-dir', 'config/locales'], {}, workDir);
    expect(config.localesDir).toBe(path.join(workDir, 'config', 'locales'));
  });

  it('falls back to I18N_LOCALES_DIR, then <cwd>/config/locales', async () => {
    const envDir = path.join(workDir, 'env-locales');
    await fs.mkdir(envDir);
    const fromEnv = await resolveConfig([], { I18N_LOCALES_DIR: envDir }, workDir);
    expect(fromEnv.localesDir).toBe(envDir);

    const fromCwd = await resolveConfig([], {}, workDir);
    expect(fromCwd.localesDir).toBe(path.join(workDir, 'config', 'locales'));
  });

  it('passes through --default-file', async () => {
    const config = await resolveConfig(
      ['--locales-dir', 'config/locales', '--default-file', 'custom.yml'],
      {},
      workDir,
    );
    expect(config.defaultFile).toBe('custom.yml');
  });

  it('rejects a missing locales directory with a helpful message', async () => {
    await expect(resolveConfig(['--locales-dir', 'nope'], {}, workDir)).rejects.toThrow(
      /Locales directory not found.*--locales-dir/s,
    );
  });

  it('rejects a locales path that is a file', async () => {
    const file = path.join(workDir, 'a-file');
    await fs.writeFile(file, 'x', 'utf8');
    await expect(resolveConfig(['--locales-dir', file], {}, workDir)).rejects.toThrow(
      'not a directory',
    );
  });

  it('rejects unknown arguments and --help with usage text', async () => {
    await expect(resolveConfig(['--bogus'], {}, workDir)).rejects.toThrow('Unknown argument: --bogus');
    await expect(resolveConfig(['--help'], {}, workDir)).rejects.toThrow('Usage: i18n-mcp');
  });
});
