import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InlineConfig, ViteDevServer } from 'vite';
import { build, createServer } from 'vite';

import { unwrap } from '#testHelpers';
import svgToIco from '#vite-svg-to-ico';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/basic-project');
const ICON_SVG = join(FIXTURES, 'icon.svg');

/** Build a vite project in-memory and return output files as a map of fileName → source. */
async function runBuild(pluginOpts: Parameters<typeof svgToIco>[0], viteOverrides: Partial<InlineConfig> = {}) {
	const outDir = join(FIXTURES, `dist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
	await build({
		root: FIXTURES,
		logLevel: 'silent',
		build: {
			outDir,
			write: true,
			emptyOutDir: true,
		},
		plugins: [svgToIco(pluginOpts)],
		...viteOverrides,
	});

	// Collect files
	const files = new Map<string, Buffer>();
	const collectDir = async (dir: string, prefix = '') => {
		const { readdirSync, statSync } = require('node:fs');
		try {
			for (const name of readdirSync(dir)) {
				const full = join(dir, name);
				const rel = prefix ? `${prefix}/${name}` : name;
				if (statSync(full).isDirectory()) {
					await collectDir(full, rel);
				} else {
					files.set(rel, Buffer.from(await Bun.file(full).arrayBuffer()));
				}
			}
		} catch {
			/* dir may not exist */
		}
	};
	await collectDir(outDir);

	// Cleanup
	rmSync(outDir, { recursive: true, force: true });

	return files;
}

/** Fetch a path from a running Vite dev server. */
async function devFetch(server: ViteDevServer, path: string): Promise<Response> {
	const address = server.httpServer?.address();
	if (!address || typeof address === 'string') throw new Error('Server not listening');
	const url = `http://localhost:${address.port}${path}`;
	return fetch(url);
}

describe('integration', () => {
	describe('build', () => {
		describe('ICO output', () => {
			it('uses favicon.ico and the default sizes by default', async () => {
				const files = await runBuild({ input: 'icon.svg' });
				expect(files.has('favicon.ico')).toBe(true);

				const ico = unwrap(files.get('favicon.ico'));
				// ICO magic: reserved=0x0000, type=0x0001
				expect(ico[0]).toBe(0);
				expect(ico[1]).toBe(0);
				expect(ico.readUInt16LE(2)).toBe(1);
				// Default 3 sizes → 3 entries
				expect(ico.readUInt16LE(4)).toBe(3);
			});

			it('supports a custom filename', async () => {
				const files = await runBuild({ input: 'icon.svg', output: 'icon.ico' });
				expect(files.has('icon.ico')).toBe(true);
				expect(files.has('favicon.ico')).toBe(false);
			});

			it('supports custom sizes', async () => {
				const files = await runBuild({ input: 'icon.svg', sizes: [16, 64, 256] });
				const ico = unwrap(files.get('favicon.ico'));
				expect(ico.readUInt16LE(4)).toBe(3);

				// Size 256 is encoded as 0 in ICO
				const entry256Width = ico[6 + 2 * 16]; // 3rd entry, offset 6 (header) + 2*16
				expect(entry256Width).toBe(0);
			});

			it('supports a single size', async () => {
				const files = await runBuild({ input: 'icon.svg', sizes: 32 });
				const ico = unwrap(files.get('favicon.ico'));
				expect(ico.readUInt16LE(4)).toBe(1);
				expect(ico[6]).toBe(32); // width
			});
		});

		describe('source output', () => {
			it('copies the SVG', async () => {
				const files = await runBuild({ input: 'icon.svg', emit: [{ format: 'ico' }, { format: 'svg' }] });
				expect(files.has('favicon.ico')).toBe(true);
				expect(files.has('icon.svg')).toBe(true);

				const svg = unwrap(files.get('icon.svg')).toString();
				expect(svg).toContain('<svg');
			});

			it('supports a custom filename', async () => {
				const files = await runBuild({
					input: 'icon.svg',
					emit: [{ format: 'ico' }, { format: 'svg', filename: 'logo.svg' }],
				});
				expect(files.has('logo.svg')).toBe(true);
				expect(files.has('icon.svg')).toBe(false);
			});
		});

		describe('per-size output', () => {
			it('emits PNGs', async () => {
				const files = await runBuild({
					input: 'icon.svg',
					sizes: [16, 32],
					emit: [{ format: 'ico' }, { format: 'png', sizes: [16, 32] }],
				});
				expect(files.has('favicon.ico')).toBe(true);
				expect(files.has('favicon-16x16.png')).toBe(true);
				expect(files.has('favicon-32x32.png')).toBe(true);

				// Verify they're actually PNGs (magic bytes)
				const png16 = unwrap(files.get('favicon-16x16.png'));
				expect(png16[0]).toBe(0x89);
				expect(png16[1]).toBe(0x50); // P
				expect(png16[2]).toBe(0x4e); // N
				expect(png16[3]).toBe(0x47); // G
			});

			it('emits ICOs', async () => {
				const files = await runBuild({
					input: 'icon.svg',
					sizes: [16, 32],
					emit: [
						{ format: 'ico' },
						{ format: 'ico', sizes: [16], filename: 'favicon-16x16.ico' },
						{ format: 'ico', sizes: [32], filename: 'favicon-32x32.ico' },
					],
				});
				expect(files.has('favicon-16x16.ico')).toBe(true);
				expect(files.has('favicon-32x32.ico')).toBe(true);
				// Should NOT have PNGs
				expect(files.has('favicon-16x16.png')).toBe(false);

				// Each single-size ICO should have 1 entry
				const ico16 = unwrap(files.get('favicon-16x16.ico'));
				expect(ico16.readUInt16LE(4)).toBe(1);
				expect(ico16[6]).toBe(16);
			});

			it('emits PNGs and ICOs together', async () => {
				const files = await runBuild({
					input: 'icon.svg',
					sizes: [32],
					emit: [
						{ format: 'ico' },
						{ format: 'png', sizes: [32] },
						{ format: 'ico', sizes: [32], filename: 'favicon-32x32.ico' },
					],
				});
				expect(files.has('favicon-32x32.png')).toBe(true);
				expect(files.has('favicon-32x32.ico')).toBe(true);
			});
		});

		describe('linked HTML injection', () => {
			it('adds the default link tags', async () => {
				// Use the inject variant of index.html (no existing icon link)
				await Bun.write(join(FIXTURES, 'index.html.bak'), Bun.file(join(FIXTURES, 'index.html.inject')));
				const originalHtml = await Bun.file(join(FIXTURES, 'index.html')).text();
				await Bun.write(join(FIXTURES, 'index.html'), Bun.file(join(FIXTURES, 'index.html.inject')));

				try {
					const files = await runBuild({ input: 'icon.svg', emit: [{ format: 'ico', inject: true }] });
					const html = files.get('index.html')?.toString() ?? '';
					expect(html).toContain('rel="icon"');
					expect(html).toContain('href="/favicon.ico"');
					expect(html).toContain('image/x-icon');
				} finally {
					// Restore original
					await Bun.write(join(FIXTURES, 'index.html'), originalHtml);
					rmSync(join(FIXTURES, 'index.html.bak'), { force: true });
				}
			});

			it('includes per-size links', async () => {
				const originalHtml = await Bun.file(join(FIXTURES, 'index.html')).text();
				await Bun.write(join(FIXTURES, 'index.html'), Bun.file(join(FIXTURES, 'index.html.inject')));

				try {
					const files = await runBuild({
						input: 'icon.svg',
						emit: [
							{ format: 'ico', inject: true },
							{ format: 'svg', inject: true },
							{ format: 'png', sizes: [16, 32], inject: true },
						],
						sizes: [16, 32],
					});
					const html = files.get('index.html')?.toString() ?? '';
					// ICO link
					expect(html).toContain('href="/favicon.ico"');
					// SVG source link
					expect(html).toContain('image/svg+xml');
					expect(html).toContain('href="/icon.svg"');
					// Per-size PNG links
					expect(html).toContain('href="/favicon-16x16.png"');
					expect(html).toContain('href="/favicon-32x32.png"');
				} finally {
					await Bun.write(join(FIXTURES, 'index.html'), originalHtml);
				}
			});

			it('replaces existing icon links', async () => {
				// index.html has an existing <link rel="icon" href="/favicon.ico" />
				const files = await runBuild({ input: 'icon.svg', emit: [{ format: 'ico', inject: true }] });
				const html = files.get('index.html')?.toString() ?? '';

				// Should have exactly one ico link (injected), not a duplicate
				const icoMatches = html.match(/rel="icon"[^>]*favicon\.ico/g);
				expect(icoMatches).not.toBeNull();
				expect(unwrap(icoMatches).length).toBe(1);
			});
		});

		describe('embedded HTML injection', () => {
			it('inlines the SVG without writing an SVG file', async () => {
				const originalHtml = await Bun.file(join(FIXTURES, 'index.html')).text();
				await Bun.write(join(FIXTURES, 'index.html'), Bun.file(join(FIXTURES, 'index.html.inject')));

				try {
					const files = await runBuild({
						input: 'icon.svg',
						emit: [
							{ format: 'ico', sizes: [16, 32] }, // emit-only fallback, no <link>
							{ format: 'svg', emit: false, inject: 'embed', encoding: 'utf8' },
						],
					});
					const html = files.get('index.html')?.toString() ?? '';

					// SVG inlined as a utf8 data URI, not a file reference.
					expect(html).toContain('href="data:image/svg+xml,');
					expect(html).toContain('image/svg+xml');
					// emit:false → no SVG file written; ICO still emitted as the silent fallback.
					expect(files.has('icon.svg')).toBe(false);
					expect(files.has('favicon.svg')).toBe(false);
					expect(files.has('favicon.ico')).toBe(true);
					// Data URIs must never be cache-busted (a query param corrupts the bytes).
					const dataHref = unwrap(html.match(/href="(data:[^"]*)"/))[1];
					expect(dataHref).not.toContain('?v=');
					expect(dataHref).not.toContain('&v=');
				} finally {
					await Bun.write(join(FIXTURES, 'index.html'), originalHtml);
				}
			});

			it('inlines the ICO alongside the emitted file', async () => {
				const originalHtml = await Bun.file(join(FIXTURES, 'index.html')).text();
				await Bun.write(join(FIXTURES, 'index.html'), Bun.file(join(FIXTURES, 'index.html.inject')));

				try {
					const files = await runBuild({
						input: 'icon.svg',
						emit: [{ format: 'ico', sizes: [16], inject: 'embed' }],
					});
					const html = files.get('index.html')?.toString() ?? '';
					expect(html).toContain('href="data:image/x-icon;base64,');
					// inject:'embed' with default emit → file still on disk ("both").
					expect(files.has('favicon.ico')).toBe(true);
				} finally {
					await Bun.write(join(FIXTURES, 'index.html'), originalHtml);
				}
			});
		});

		describe('input formats', () => {
			it('accepts PNG input', async () => {
				// Generate a PNG fixture from the SVG first
				const sharp = (await import('sharp')).default;
				const pngPath = join(FIXTURES, 'icon.png');
				await sharp(Buffer.from(await Bun.file(ICON_SVG).arrayBuffer())).resize(64, 64).png().toFile(pngPath);

				try {
					const files = await runBuild({ input: 'icon.png' });
					expect(files.has('favicon.ico')).toBe(true);
					const ico = unwrap(files.get('favicon.ico'));
					expect(ico.readUInt16LE(2)).toBe(1); // ICO type
				} finally {
					rmSync(pngPath, { force: true });
				}
			});
		});

		describe('Sharp options', () => {
			it('forwards resize options', async () => {
				const files = await runBuild({
					input: 'icon.svg',
					sizes: [16],
					sharp: { resize: { kernel: 'nearest' } },
				});
				expect(files.has('favicon.ico')).toBe(true);
				// Can't easily verify kernel in output, but ensures no error
			});

			it('forwards PNG options', async () => {
				const files = await runBuild({
					input: 'icon.svg',
					sizes: [32],
					sharp: { png: { palette: true, colours: 64 } },
				});
				const ico = unwrap(files.get('favicon.ico'));
				expect(ico.readUInt16LE(4)).toBe(1);
			});
		});
	});

	describe('dev server', () => {
		let server: ViteDevServer;

		beforeAll(async () => {
			server = await createServer({
				root: FIXTURES,
				logLevel: 'silent',
				server: { port: 0, strictPort: false },
				plugins: [
					svgToIco({
						input: 'icon.svg',
						sizes: [16, 32],
						emit: [
							{ format: 'ico', inject: true },
							{ format: 'svg', inject: true },
							{ format: 'png', sizes: [16, 32], inject: true },
						],
					}),
				],
			});
			await server.listen();
		});

		afterAll(async () => {
			await server?.close();
		});

		describe('served assets', () => {
			it('serves favicon.ico with the correct content type', async () => {
				const res = await devFetch(server, '/favicon.ico');
				expect(res.status).toBe(200);
				expect(res.headers.get('content-type')).toBe('image/x-icon');

				const buf = Buffer.from(await res.arrayBuffer());
				expect(buf.readUInt16LE(2)).toBe(1); // ICO type
				expect(buf.readUInt16LE(4)).toBe(2); // 2 sizes
			});

			it('serves the source SVG', async () => {
				const res = await devFetch(server, '/icon.svg');
				expect(res.status).toBe(200);
				expect(res.headers.get('content-type')).toBe('image/svg+xml');

				const text = await res.text();
				expect(text).toContain('<svg');
			});

			it('serves per-size PNGs', async () => {
				const res16 = await devFetch(server, '/favicon-16x16.png');
				expect(res16.status).toBe(200);
				expect(res16.headers.get('content-type')).toBe('image/png');

				const buf = Buffer.from(await res16.arrayBuffer());
				// PNG magic
				expect(buf[0]).toBe(0x89);
				expect(buf.subarray(1, 4).toString()).toBe('PNG');

				const res32 = await devFetch(server, '/favicon-32x32.png');
				expect(res32.status).toBe(200);
			});
		});

		describe('HTML injection', () => {
			it('injects favicon link tags', async () => {
				const res = await devFetch(server, '/');
				expect(res.status).toBe(200);
				const html = await res.text();

				// ICO link
				expect(html).toContain('image/x-icon');
				expect(html).toContain('favicon.ico');
				// SVG link
				expect(html).toContain('image/svg+xml');
				// Per-size links
				expect(html).toContain('favicon-16x16.png');
				expect(html).toContain('favicon-32x32.png');
			});

			it('injects the HMR client script', async () => {
				const res = await devFetch(server, '/');
				const html = await res.text();
				expect(html).toContain('svg-to-ico:update');
				expect(html).toContain('import.meta.hot');
			});
		});

		it('marks favicon responses as no-cache', async () => {
			const res = await devFetch(server, '/favicon.ico');
			expect(res.headers.get('cache-control')).toBe('no-cache');
		});
	});

	describe('dev option', () => {
		it('returns 404 for favicon.ico when disabled', async () => {
			const srv = await createServer({
				root: FIXTURES,
				logLevel: 'silent',
				server: { port: 0, strictPort: false },
				plugins: [svgToIco({ input: 'icon.svg', dev: false })],
			});
			await srv.listen();
			try {
				const res = await devFetch(srv, '/favicon.ico');
				expect(res.status).not.toBe(200);
			} finally {
				await srv.close();
			}
		});

		it('injects a shim script instead of link tags in shim mode', async () => {
			const srv = await createServer({
				root: FIXTURES,
				logLevel: 'silent',
				server: { port: 0, strictPort: false },
				plugins: [svgToIco({ input: 'icon.svg', emit: [{ format: 'ico', inject: true }], dev: { injection: 'shim' } })],
			});
			await srv.listen();
			try {
				const res = await devFetch(srv, '/');
				const html = await res.text();
				// Shim script creates links dynamically
				expect(html).toContain('document.createElement("link")');
				expect(html).toContain('favicon.ico');
				// Should have HMR code by default
				expect(html).toContain('import.meta.hot');
			} finally {
				await srv.close();
			}
		});

		it('does not inject the HMR script when HMR is disabled', async () => {
			const srv = await createServer({
				root: FIXTURES,
				logLevel: 'silent',
				server: { port: 0, strictPort: false },
				plugins: [svgToIco({ input: 'icon.svg', emit: [{ format: 'ico', inject: true }], dev: { hmr: false } })],
			});
			await srv.listen();
			try {
				const res = await devFetch(srv, '/');
				const html = await res.text();
				// Should have link tags (transform mode)
				expect(html).toContain('favicon.ico');
				// Should NOT have HMR code
				expect(html).not.toContain('svg-to-ico:update');
			} finally {
				await srv.close();
			}
		});

		it('omits HMR code from the shim when HMR is disabled', async () => {
			const srv = await createServer({
				root: FIXTURES,
				logLevel: 'silent',
				server: { port: 0, strictPort: false },
				plugins: [
					svgToIco({
						input: 'icon.svg',
						emit: [{ format: 'ico', inject: true }],
						dev: { injection: 'shim', hmr: false },
					}),
				],
			});
			await srv.listen();
			try {
				const res = await devFetch(srv, '/');
				const html = await res.text();
				// Has shim
				expect(html).toContain('document.createElement("link")');
				// No HMR
				expect(html).not.toContain('import.meta.hot');
			} finally {
				await srv.close();
			}
		});
	});
});
