/**
 * Smoke test: build the workspace-member fixture and assert it emitted the
 * expected files + injected the expected `<link>` tags.
 *
 * The fixture (`tests/smoke/fixture`) is a Bun workspace member — its
 * `vite-svg-to-ico` dep resolves through `workspace:*`, and `vite` through
 * the root `catalog`. So this exercises the path real consumers take
 * (Node loader → `dist/index.mjs`) without needing tmpdir/copy/rewrite
 * gymnastics in the driver.
 *
 * Auto-skipped when `dist/index.mjs` is absent so a fresh clone running
 * `bun test` doesn't fail. CI builds the plugin before invoking `bun test`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const FIXTURE = resolve(import.meta.dirname, 'smoke/fixture');
const FIXTURE_DIST = join(FIXTURE, 'dist');
const DIST_ENTRY = join(REPO_ROOT, 'dist/index.mjs');

const hasDist = existsSync(DIST_ENTRY);

describe.skipIf(!hasDist)('smoke', () => {
	describe('real Vite consumer build', () => {
		let buildExitCode: number;
		let html: string;
		let emittedFiles: Set<string>;

		beforeAll(async () => {
			await Bun.$`rm -rf ${FIXTURE_DIST}`.quiet().nothrow();

			const build = await Bun.$`bun run build`.cwd(FIXTURE).quiet().nothrow();
			buildExitCode = build.exitCode;

			html = await Bun.file(join(FIXTURE_DIST, 'index.html')).text();
			emittedFiles = new Set(await Array.fromAsync(new Bun.Glob('*').scan(FIXTURE_DIST)));
		}, 60_000);

		afterAll(async () => {
			await Bun.$`rm -rf ${FIXTURE_DIST}`.quiet().nothrow();
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
});
