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
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DIST_ENTRY = resolve(REPO_ROOT, 'dist/index.mjs');
const FIXTURE = resolve(REPO_ROOT, 'tests/smoke/fixture');

if (!existsSync(DIST_ENTRY)) {
	await $`bun --bun bd`.cwd(REPO_ROOT);
}
await $`bun link`.cwd(REPO_ROOT).quiet();
await $`bun install`.cwd(FIXTURE).quiet();
