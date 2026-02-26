import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { copyFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, createServer, type InlineConfig, type ViteDevServer } from 'vite';

import svgToIco from '$/index.ts';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/basic-project');
const ICON_SVG = join(FIXTURES, 'icon.svg');

// ---------- helpers ----------

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
	const collectDir = (dir: string, prefix = '') => {
		const { readdirSync, statSync } = require('node:fs');
		try {
			for (const name of readdirSync(dir)) {
				const full = join(dir, name);
				const rel = prefix ? `${prefix}/${name}` : name;
				if (statSync(full).isDirectory()) {
					collectDir(full, rel);
				} else {
					files.set(rel, readFileSync(full));
				}
			}
		} catch { /* dir may not exist */ }
	};
	collectDir(outDir);

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

// ---------- Build integration tests ----------

describe('integration: build', () => {
	it('emits favicon.ico with default options', async () => {
		const files = await runBuild({ input: 'icon.svg' });
		expect(files.has('favicon.ico')).toBe(true);

		const ico = files.get('favicon.ico')!;
		// ICO magic: reserved=0x0000, type=0x0001
		expect(ico[0]).toBe(0);
		expect(ico[1]).toBe(0);
		expect(ico.readUInt16LE(2)).toBe(1);
		// Default 3 sizes → 3 entries
		expect(ico.readUInt16LE(4)).toBe(3);
	});

	it('emits custom-named output', async () => {
		const files = await runBuild({ input: 'icon.svg', output: 'icon.ico' });
		expect(files.has('icon.ico')).toBe(true);
		expect(files.has('favicon.ico')).toBe(false);
	});

	it('emits with custom sizes', async () => {
		const files = await runBuild({ input: 'icon.svg', sizes: [16, 64, 256] });
		const ico = files.get('favicon.ico')!;
		expect(ico.readUInt16LE(4)).toBe(3);

		// Size 256 is encoded as 0 in ICO
		const entry256Width = ico[6 + 2 * 16]; // 3rd entry, offset 6 (header) + 2*16
		expect(entry256Width).toBe(0);
	});

	it('emits single size', async () => {
		const files = await runBuild({ input: 'icon.svg', sizes: 32 });
		const ico = files.get('favicon.ico')!;
		expect(ico.readUInt16LE(4)).toBe(1);
		expect(ico[6]).toBe(32); // width
	});

	it('includeSource copies SVG to output', async () => {
		const files = await runBuild({ input: 'icon.svg', includeSource: true });
		expect(files.has('favicon.ico')).toBe(true);
		expect(files.has('icon.svg')).toBe(true);

		const svg = files.get('icon.svg')!.toString();
		expect(svg).toContain('<svg');
	});

	it('includeSource with custom name', async () => {
		const files = await runBuild({
			input: 'icon.svg',
			includeSource: { name: 'logo.svg' },
		});
		expect(files.has('logo.svg')).toBe(true);
		expect(files.has('icon.svg')).toBe(false);
	});

	it('emitSizes=true emits per-size PNGs', async () => {
		const files = await runBuild({ input: 'icon.svg', sizes: [16, 32], emitSizes: true });
		expect(files.has('favicon.ico')).toBe(true);
		expect(files.has('favicon-16x16.png')).toBe(true);
		expect(files.has('favicon-32x32.png')).toBe(true);

		// Verify they're actually PNGs (magic bytes)
		const png16 = files.get('favicon-16x16.png')!;
		expect(png16[0]).toBe(0x89);
		expect(png16[1]).toBe(0x50); // P
		expect(png16[2]).toBe(0x4e); // N
		expect(png16[3]).toBe(0x47); // G
	});

	it('emitSizes="ico" emits per-size ICOs', async () => {
		const files = await runBuild({ input: 'icon.svg', sizes: [16, 32], emitSizes: 'ico' });
		expect(files.has('favicon-16x16.ico')).toBe(true);
		expect(files.has('favicon-32x32.ico')).toBe(true);
		// Should NOT have PNGs
		expect(files.has('favicon-16x16.png')).toBe(false);

		// Each single-size ICO should have 1 entry
		const ico16 = files.get('favicon-16x16.ico')!;
		expect(ico16.readUInt16LE(4)).toBe(1);
		expect(ico16[6]).toBe(16);
	});

	it('emitSizes="both" emits PNGs and ICOs', async () => {
		const files = await runBuild({ input: 'icon.svg', sizes: [32], emitSizes: 'both' });
		expect(files.has('favicon-32x32.png')).toBe(true);
		expect(files.has('favicon-32x32.ico')).toBe(true);
	});

	it('inject="minimal" adds link tags to HTML', async () => {
		// Use the inject variant of index.html (no existing icon link)
		copyFileSync(join(FIXTURES, 'index.html.inject'), join(FIXTURES, 'index.html.bak'));
		const originalHtml = readFileSync(join(FIXTURES, 'index.html')).toString();
		copyFileSync(join(FIXTURES, 'index.html.inject'), join(FIXTURES, 'index.html'));

		try {
			const files = await runBuild({ input: 'icon.svg', inject: 'minimal' });
			const html = files.get('index.html')?.toString() ?? '';
			expect(html).toContain('rel="icon"');
			expect(html).toContain('href="/favicon.ico"');
			expect(html).toContain('image/x-icon');
		} finally {
			// Restore original
			Bun.write(join(FIXTURES, 'index.html'), originalHtml);
			rmSync(join(FIXTURES, 'index.html.bak'), { force: true });
		}
	});

	it('inject="full" includes per-size links', async () => {
		const originalHtml = readFileSync(join(FIXTURES, 'index.html')).toString();
		copyFileSync(join(FIXTURES, 'index.html.inject'), join(FIXTURES, 'index.html'));

		try {
			const files = await runBuild({
				input: 'icon.svg',
				inject: 'full',
				emitSizes: 'png',
				sizes: [16, 32],
				includeSource: true,
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
			Bun.write(join(FIXTURES, 'index.html'), originalHtml);
		}
	});

	it('inject strips existing icon links and replaces', async () => {
		// index.html has an existing <link rel="icon" href="/favicon.ico" />
		const files = await runBuild({ input: 'icon.svg', inject: 'minimal' });
		const html = files.get('index.html')?.toString() ?? '';

		// Should have exactly one ico link (injected), not a duplicate
		const icoMatches = html.match(/rel="icon"[^>]*favicon\.ico/g);
		expect(icoMatches).not.toBeNull();
		expect(icoMatches!.length).toBe(1);
	});

	it('works with PNG input', async () => {
		// Generate a PNG fixture from the SVG first
		const sharp = (await import('sharp')).default;
		const pngPath = join(FIXTURES, 'icon.png');
		await sharp(readFileSync(ICON_SVG)).resize(64, 64).png().toFile(pngPath);

		try {
			const files = await runBuild({ input: 'icon.png' });
			expect(files.has('favicon.ico')).toBe(true);
			const ico = files.get('favicon.ico')!;
			expect(ico.readUInt16LE(2)).toBe(1); // ICO type
		} finally {
			rmSync(pngPath, { force: true });
		}
	});

	it('resize options are forwarded (nearest kernel for pixel art)', async () => {
		const files = await runBuild({
			input: 'icon.svg',
			sizes: [16],
			resize: { kernel: 'nearest' },
		});
		expect(files.has('favicon.ico')).toBe(true);
		// Can't easily verify kernel in output, but ensures no error
	});

	it('png options are forwarded (palette mode)', async () => {
		const files = await runBuild({
			input: 'icon.svg',
			sizes: [32],
			png: { palette: true, colours: 64 },
		});
		const ico = files.get('favicon.ico')!;
		expect(ico.readUInt16LE(4)).toBe(1);
	});
});

// ---------- Dev server integration tests ----------

describe('integration: dev server', () => {
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
					includeSource: true,
					emitSizes: true,
					inject: 'full',
				}),
			],
		});
		await server.listen();
	});

	afterAll(async () => {
		await server?.close();
	});

	it('serves favicon.ico with correct content-type', async () => {
		const res = await devFetch(server, '/favicon.ico');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/x-icon');

		const buf = Buffer.from(await res.arrayBuffer());
		expect(buf.readUInt16LE(2)).toBe(1); // ICO type
		expect(buf.readUInt16LE(4)).toBe(2); // 2 sizes
	});

	it('serves source SVG', async () => {
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

	it('injects favicon link tags into index.html', async () => {
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

	it('injects HMR client script', async () => {
		const res = await devFetch(server, '/');
		const html = await res.text();
		expect(html).toContain('svg-to-ico:update');
		expect(html).toContain('import.meta.hot');
	});

	it('sets no-cache header on favicon', async () => {
		const res = await devFetch(server, '/favicon.ico');
		expect(res.headers.get('cache-control')).toBe('no-cache');
	});
});
