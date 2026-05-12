/**
 * Smoke test: scaffold a real Vite consumer project in a tmp dir, install
 * this repo as `vite-svg-to-ico` via `file:`, run `bun run build`, then
 * assert the build emitted the expected files and injected the expected
 * `<link>` tags.
 *
 * This exercises the path real consumers take — resolving the plugin
 * through `node_modules` (Node loader → `dist/index.mjs`), not the
 * direct-source import path that the rest of `tests/` uses. The PNG
 * size-cap regression (1–256 ICO constraint leaking onto PngSpec) was
 * caught here, not in the unit suite.
 *
 * Skipped automatically when `dist/index.mjs` is missing. CI builds the
 * plugin before invoking `bun test` so the smoke test fires.
 */

import { $ } from 'bun';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const FIXTURE = resolve(import.meta.dirname, 'smoke/fixture');
const DIST_ENTRY = join(REPO_ROOT, 'dist/index.mjs');

// Smoke depends on the built dist — skip when it's not present (e.g. fresh
// clone before `bun run build`). CI runs `bun run build && bun test` so it
// always fires there.
const hasDist = existsSync(DIST_ENTRY);

describe.skipIf(!hasDist)('smoke: real Vite consumer build', () => {
	let tmpRoot: string;
	let buildExitCode: number;
	let html: string;
	let emittedFiles: Set<string>;

	beforeAll(async () => {
		tmpRoot = mkdtempSync(join(tmpdir(), 'vsi-smoke-'));
		await cp(FIXTURE, tmpRoot, { recursive: true });

		// Rewrite the placeholder dep spec to an absolute file: path pointing
		// at this repo. file: pulls in the plugin's own `package.json` exports,
		// so Vite resolves `vite-svg-to-ico` through the same path real users do.
		const pkgPath = join(tmpRoot, 'package.json');
		const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
		pkg.dependencies['vite-svg-to-ico'] = `file:${REPO_ROOT}`;
		await Bun.write(pkgPath, JSON.stringify(pkg, null, '\t'));

		// Use the same Bun that's running the test; mute the install + build logs
		// so a successful run is silent and a failure is the only thing visible.
		await $`bun install`.cwd(tmpRoot).quiet();
		const build = await $`bun run build`.cwd(tmpRoot).quiet().nothrow();
		buildExitCode = build.exitCode;

		const distDir = join(tmpRoot, 'dist');
		html = await readFile(join(distDir, 'index.html'), 'utf8');
		emittedFiles = new Set(await Array.fromAsync(new Bun.Glob('*').scan(distDir)));
	}, 60_000);

	afterAll(() => {
		if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
	});

	it('build exits 0', () => {
		expect(buildExitCode).toBe(0);
	});

	it('emits combined ICO + per-size PNGs + SVG copy', () => {
		expect(emittedFiles.has('favicon.ico')).toBe(true);
		expect(emittedFiles.has('favicon-192x192.png')).toBe(true);
		expect(emittedFiles.has('favicon-512x512.png')).toBe(true);
		expect(emittedFiles.has('logo.svg')).toBe(true);
	});

	it('injects ICO link with combined sizes', () => {
		expect(html).toContain('rel="icon"');
		expect(html).toContain('type="image/x-icon"');
		expect(html).toContain('href="/favicon.ico"');
		expect(html).toContain('sizes="16x16 32x32 48x48"');
	});

	it('injects PNG link for the 192 size only (per inject.sizes subset)', () => {
		expect(html).toContain('href="/favicon-192x192.png"');
		expect(html).not.toContain('href="/favicon-512x512.png"');
	});

	it('injects SVG link with sizes="any"', () => {
		expect(html).toContain('type="image/svg+xml"');
		expect(html).toContain('href="/logo.svg"');
		expect(html).toContain('sizes="any"');
	});
});
