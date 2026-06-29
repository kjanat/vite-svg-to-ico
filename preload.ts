/**
 * Preload for `bun test`: bootstraps the smoke-test fixture once before
 * any test file runs. Wired in via `bunfig.toml [test] preload`, so both
 * local invocations and CI converge on plain `bun test` — no `&&` chain,
 * no orchestrator script, no duplicated yaml steps.
 *
 * Idempotent: builds dist if missing, registers `bun link`, installs the
 * fixture. Each step is cheap on a warm tree (sub-second).
 */
import { $ } from 'bun';

import { afterAll, beforeAll } from 'bun:test';
import { error, log } from 'node:console';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { exports } from '#pkg' with { type: 'json' };
import { outDir } from './tsdown.config.ts';

const getExport = (input: unknown): string | undefined => {
  return typeof input === 'string' ? input : undefined;
};

const [EXPORTS, FIXTURE] = [
  resolve(
    import.meta.dir,
    getExport(exports['.']) ?? // @ts-expect-error
      getExport(exports['.']['import']) ??
      getExport(exports['.']['default']) ?? // @ts-expect-error
      getExport(exports['.']['require']) ??
      'dist/index.js',
  ),
  resolve(import.meta.dir, 'tests/smoke/fixture'),
];

beforeAll(async () => {
  // Build the dist entry if missing (e.g. first run, or after a clean).
  if (existsSync(EXPORTS)) await $`rm -rf ${outDir}`.cwd(import.meta.dir);

  try {
    await $`bun --bun bd`.cwd(import.meta.dir).quiet();
    log('built dist entry\n');

    await $`bun link`.cwd(import.meta.dir);
    log('linked package\n');

    await $`bun link vite-svg-to-ico`.cwd(FIXTURE);
    log('linked package into fixture\n');
  } catch (err) {
    error('Smoke-test setup failed:', err);
    throw err;
  }

  // Install the fixture's dependencies, which will pick up the linked package.
  await $`bun install`.cwd(FIXTURE).quiet();
});

afterAll(async () => {
  await $`bun unlink vite-svg-to-ico`.cwd(FIXTURE).nothrow();
  log('unlinked package from fixture\n');

  await $`bun unlink`.cwd(import.meta.dir);
  log('unlinked package from local tree');
});
