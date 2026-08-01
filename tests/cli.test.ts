import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cwd } from 'node:process';
import { strip } from 'ansispeck';
import { createOutput } from 'dreamcli';
import { runCommand } from 'dreamcli/testkit';
import { app } from '#cli';
import { inject } from '#cli/commands/inject';
import { generate } from '#internals/cli/commands/generate.ts';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/test.svg');
const CLI_ENTRY = Bun.fileURLToPath(import.meta.resolve('#cli'));

async function setupTmp(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'vite-svg-to-ico-cli-'));
}

/**
 * Build a `typeof fetch`-compatible stub. The `preconnect` no-op is required to
 * fully satisfy the global `fetch` shape; without it TS rejects assignment.
 */
function makeFetchStub(
	impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
	return Object.assign(impl, { preconnect: () => {} });
}

async function withStubbedFetch<T>(stub: typeof globalThis.fetch, fn: () => Promise<T>): Promise<T> {
	const original = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		return await fn();
	} finally {
		globalThis.fetch = original;
	}
}

describe('CLI', () => {
	describe('generate', () => {
		it('documents the derived out dir without capturing an absolute path', async () => {
			const result = await runCommand(generate, ['--help']);
			expect(result.exitCode).toBe(0);

			const help = strip(result.stdout.join('\n'));
			const flatHelp = help.replace(/\s+/g, ' ');
			expect(flatHelp).toContain("Defaults to the source image's own directory");
			// Guards a past bug: the rendering machine's absolute cwd leaking into help.
			expect(flatHelp).not.toContain('back to the current directory. (default:');
			expect(help).not.toContain(cwd());
		});

		it('writes beside the source image by default, not into the invocation cwd', async () => {
			const dir = await setupTmp();
			const assets = join(dir, 'assets');
			await mkdir(assets, { recursive: true });
			await Bun.write(join(assets, 'icon.svg'), await Bun.file(FIXTURE).text());

			const result = await Bun.$`bun ${CLI_ENTRY} generate assets/icon.svg --sizes 16`.cwd(dir).quiet().nothrow();
			expect(result.exitCode).toBe(0);

			expect((await Bun.file(join(assets, 'favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
			expect(await Bun.file(join(dir, 'favicon.ico')).exists()).toBe(false);
		});

		it('resolves --output subdirectories against the derived out dir', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'icon.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(generate, [join(dir, 'icon.svg'), '--sizes', '16', '-o', 'icons/favicon.ico']);
			expect(result.exitCode).toBe(0);
			expect((await Bun.file(join(dir, 'icons/favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
		});

		it('names the ICO favicon.ico regardless of the source name by default', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'logo.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(generate, [join(dir, 'logo.svg'), '--sizes', '16']);
			expect(result.exitCode).toBe(0);
			expect(await Bun.file(join(dir, 'favicon.ico')).exists()).toBe(true);
			expect(await Bun.file(join(dir, 'logo.ico')).exists()).toBe(false);
		});

		it('--keep-name names the ICO after the source, per-size files included', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'logo.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(
				generate,
				[join(dir, 'logo.svg'), '--sizes', '16', '--keep-name', '--emit-sizes', 'both'],
			);
			expect(result.exitCode).toBe(0);
			expect((await Bun.file(join(dir, 'logo.ico')).bytes()).byteLength).toBeGreaterThan(0);
			expect(await Bun.file(join(dir, 'logo-16x16.png')).exists()).toBe(true);
			expect(await Bun.file(join(dir, 'logo-16x16.ico')).exists()).toBe(true);
			expect(await Bun.file(join(dir, 'favicon.ico')).exists()).toBe(false);
		});

		it('--keep-name derives from a URL basename for remote sources', async () => {
			const dir = await setupTmp();
			const svgBytes = await Bun.file(FIXTURE).bytes();
			const stub = makeFetchStub(async () => new Response(svgBytes, { status: 200 }));

			const result = await withStubbedFetch(stub, () =>
				runCommand(generate, [
					'https://example.test/brand/mark.svg?v=2',
					'--out-dir',
					dir,
					'--sizes',
					'16',
					'--keep-name',
				]));
			expect(result.exitCode).toBe(0);
			expect((await Bun.file(join(dir, 'mark.ico')).bytes()).byteLength).toBeGreaterThan(0);
		});

		it('refuses --output and --keep-name together rather than picking one', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'logo.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(generate, [join(dir, 'logo.svg'), '--keep-name', '-o', 'custom.ico']);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('OUTPUT_NAME_CONFLICT');
			expect(result.error?.suggest).toContain('custom.ico');
			expect(await Bun.file(join(dir, 'custom.ico')).exists()).toBe(false);
			expect(await Bun.file(join(dir, 'logo.ico')).exists()).toBe(false);
		});

		it('--no-keep-name reopens --output for callers that preset --keep-name', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'logo.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(
				generate,
				[join(dir, 'logo.svg'), '--keep-name', '--sizes', '16', '--no-keep-name', '-o', 'custom.ico'],
			);
			expect(result.exitCode).toBe(0);
			expect((await Bun.file(join(dir, 'custom.ico')).bytes()).byteLength).toBeGreaterThan(0);
			expect(await Bun.file(join(dir, 'logo.ico')).exists()).toBe(false);
		});

		it('lets an explicit --out-dir win over the source directory', async () => {
			const dir = await setupTmp();
			const src = join(dir, 'src');
			const build = join(dir, 'build');
			await mkdir(src, { recursive: true });
			await Bun.write(join(src, 'icon.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(generate, [join(src, 'icon.svg'), '--out-dir', build, '--sizes', '16']);
			expect(result.exitCode).toBe(0);
			expect((await Bun.file(join(build, 'favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
			expect(await Bun.file(join(src, 'favicon.ico')).exists()).toBe(false);
		});

		it('skips the source copy when --emit-source would overwrite the source itself', async () => {
			const dir = await setupTmp();
			const svg = join(dir, 'icon.svg');
			const original = await Bun.file(FIXTURE).text();
			await Bun.write(svg, original);

			const result = await runCommand(generate, [svg, '--sizes', '16', '--emit-source']);
			expect(result.exitCode).toBe(0);
			expect(result.stderr.join('\n')).toContain('source already in the output directory');
			expect(await Bun.file(svg).text()).toBe(original);
		});

		it('writes a multi-size favicon.ico to the out dir', async () => {
			const dir = await setupTmp();
			const result = await runCommand(generate, [FIXTURE, '--out-dir', dir, '--sizes', '16', '--sizes', '32']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).not.toContain('\x1b');

			const stats = await Bun.file(join(dir, 'favicon.ico')).bytes();
			expect(stats.byteLength).toBeGreaterThan(0);
			// ICO magic header: reserved (00 00) + type (01 00) + count (02 00 for 2 sizes)
			expect(stats[0]).toBe(0);
			expect(stats[2]).toBe(1);
			expect(stats[4]).toBe(2);
		});

		it('uses DreamCLI colors and ansispeck hyperlinks when styling is enabled', async () => {
			const dir = await setupTmp();
			const stdout: string[] = [];
			const stderr: string[] = [];
			const out = createOutput({
				color: true,
				isTTY: true,
				stdout: (value) => stdout.push(value),
				stderr: (value) => stderr.push(value),
			});

			const result = await runCommand(generate, [FIXTURE, '--out-dir', dir, '--sizes', '16'], { out });
			expect(result.exitCode).toBe(0);

			const rendered = stderr.join('');
			expect(stdout.join('')).toBe('');
			expect(rendered).toContain('\x1b[32mWrote\x1b[39m');
			expect(rendered).toContain('\x1b]8;;file://');
			expect(rendered).toContain(`\x1b[36m${join(dir, 'favicon.ico')}\x1b[39m`);
		});

		it('silences progress notes under --quiet but still writes the ICO', async () => {
			const dir = await setupTmp();
			const result = await Bun.$`bun ${CLI_ENTRY} --quiet generate ${FIXTURE} --out-dir ${dir} --sizes 16`
				.quiet()
				.nothrow();
			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString()).toBe('');
			expect(result.stderr.toString()).toBe('');
			expect((await Bun.file(join(dir, 'favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
		});

		it('emits a machine-readable summary on stdout under --json', async () => {
			const dir = await setupTmp();
			const result = await Bun.$`bun ${CLI_ENTRY} --json generate ${FIXTURE} --out-dir ${dir} --sizes 16 --sizes 32`
				.quiet()
				.nothrow();
			expect(result.exitCode).toBe(0);

			const summary = JSON.parse(result.stdout.toString());
			expect(summary.ico).toBe(join(dir, 'favicon.ico'));
			expect(summary.sizes).toEqual([16, 32]);
			expect(summary.files).toEqual([join(dir, 'favicon.ico')]);
			expect(summary.bytes).toBeGreaterThan(0);
		});

		it('accepts --no-optimize', async () => {
			const dir = await setupTmp();
			const result = await runCommand(generate, [FIXTURE, '--out-dir', dir, '--sizes', '16', '--no-optimize']);
			expect(result.exitCode).toBe(0);
			expect((await Bun.file(join(dir, 'favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
		});

		it('emits source file when --emit-source is set', async () => {
			const dir = await setupTmp();
			const result = await runCommand(generate, [FIXTURE, '--out-dir', dir, '--emit-source']);
			expect(result.exitCode).toBe(0);

			const source = await Bun.file(join(dir, 'test.svg')).text();
			expect(source).toContain('<svg');
		});

		it('emits per-size PNGs when --emit-sizes png is set', async () => {
			const dir = await setupTmp();
			const result = await runCommand(
				generate,
				/* dprint-ignore */ [FIXTURE, '--out-dir', dir, '--sizes', '16', '--sizes', '32', '--emit-sizes', 'png'],
			);
			expect(result.exitCode).toBe(0);

			const png16 = await Bun.file(join(dir, 'favicon-16x16.png')).bytes();
			const png32 = await Bun.file(join(dir, 'favicon-32x32.png')).bytes();
			// PNG magic: 89 50 4E 47
			expect(png16[0]).toBe(0x89);
			expect(png16[1]).toBe(0x50);
			expect(png32[0]).toBe(0x89);
		});

		it('rejects invalid sizes', async () => {
			const dir = await setupTmp();
			const result = await runCommand(generate, [FIXTURE, '--out-dir', dir, '--sizes', '0', '--sizes', '500']);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.join('')).toContain("Invalid number value '0' for flag --sizes: must be >= 1");
		});

		it('fetches a URL source and writes ICO + source copy', async () => {
			const dir = await setupTmp();
			const svgBytes = await Bun.file(FIXTURE).bytes();
			const url = 'https://example.test/path/remote.svg?v=1';
			const seen: string[] = [];

			const stub = makeFetchStub(async (input) => {
				seen.push(String(input));
				return new Response(svgBytes, { status: 200, headers: { 'content-type': 'image/svg+xml' } });
			});

			const result = await withStubbedFetch(
				stub,
				() => runCommand(generate, [url, '--out-dir', dir, '--sizes', '16', '--emit-source']),
			);
			expect(result.exitCode).toBe(0);
			expect(seen).toEqual([url]);

			const ico = await Bun.file(join(dir, 'favicon.ico')).bytes();
			expect(ico.byteLength).toBeGreaterThan(0);

			// --emit-source should use the URL pathname basename, *not* including the query string.
			const sourceCopy = await Bun.file(join(dir, 'remote.svg')).text();
			expect(sourceCopy).toContain('<svg');
		});

		it('falls back to the cwd for a remote source, which has no local directory', async () => {
			const dir = await setupTmp();
			const svgBytes = await Bun.file(FIXTURE).bytes();
			const server = Bun.serve({
				port: 0,
				fetch: () => new Response(svgBytes, { headers: { 'content-type': 'image/svg+xml' } }),
			});
			try {
				const url = `http://localhost:${server.port}/remote.svg`;
				const result = await Bun.$`bun ${CLI_ENTRY} generate ${url} --sizes 16`.cwd(dir).quiet().nothrow();
				expect(result.exitCode).toBe(0);
				expect((await Bun.file(join(dir, 'favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
			} finally {
				await server.stop(true);
			}
		});

		it('accepts a file:// URL string as input', async () => {
			const dir = await setupTmp();
			const fileUrl = Bun.pathToFileURL(FIXTURE).toString();

			const result = await runCommand(generate, [fileUrl, '--out-dir', dir, '--sizes', '16']);
			expect(result.exitCode).toBe(0);

			const ico = await Bun.file(join(dir, 'favicon.ico')).bytes();
			expect(ico.byteLength).toBeGreaterThan(0);
		});

		it('reports a clear error when URL fetch fails', async () => {
			const dir = await setupTmp();
			const url = 'https://example.test/missing.svg';

			const stub = makeFetchStub(async () => new Response('not found', { status: 404, statusText: 'Not Found' }));

			const result = await withStubbedFetch(stub, () => runCommand(generate, [url, '--out-dir', dir]));
			expect(result.exitCode).not.toBe(0);
			expect([...result.stderr, ...result.stdout].join('\n')).toContain('404');
		});
	});

	describe('generate input diagnostics', () => {
		it('rejects an ICO input and points at the same-named source beside it', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'favicon.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(generate, [join(dir, 'favicon.ico'), '--out-dir', dir]);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('INPUT_IS_ICO');
			expect(result.error?.suggest).toContain(join(dir, 'favicon.svg'));
			expect(result.error?.suggest).toContain('--output');
		});

		it('explains an ICO input even when no source sits beside it', async () => {
			const dir = await setupTmp();

			const result = await runCommand(generate, [join(dir, 'favicon.ico'), '--out-dir', dir]);
			expect(result.error?.code).toBe('INPUT_IS_ICO');
			expect(result.error?.suggest).toContain('--output favicon.ico');
		});

		it('reports a missing source with the sibling the user probably meant', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'logo.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(generate, [join(dir, 'logo.png'), '--out-dir', dir]);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('INPUT_NOT_FOUND');
			expect(result.error?.message).toContain('Source image not found');
			expect(result.error?.suggest).toBe(`Did you mean '${join(dir, 'logo.svg')}'?`);
		});

		it('lists the images it did find when nothing matches the stem', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'brand.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(generate, [join(dir, 'missing.svg'), '--out-dir', dir]);
			expect(result.error?.code).toBe('INPUT_NOT_FOUND');
			expect(result.error?.suggest).toContain('brand.svg');
		});

		it('falls back to a plain hint when the directory holds no images', async () => {
			const dir = await setupTmp();

			const result = await runCommand(generate, [join(dir, 'missing.svg'), '--out-dir', dir]);
			expect(result.error?.code).toBe('INPUT_NOT_FOUND');
			expect(result.error?.suggest).toContain('not the ICO to create');
		});

		it('rejects a directory input and names an image inside it', async () => {
			const dir = await setupTmp();
			const assets = join(dir, 'assets');
			await mkdir(assets, { recursive: true });
			await Bun.write(join(assets, 'icon.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(generate, [assets, '--out-dir', dir]);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('INPUT_IS_DIRECTORY');
			expect(result.error?.suggest).toBe(`Did you mean '${join(assets, 'icon.svg')}'?`);
		});

		it('serializes the diagnostic under --json instead of an unexpected-error dump', async () => {
			const dir = await setupTmp();
			const result = await Bun.$`bun ${CLI_ENTRY} --json generate ${join(dir, 'favicon.ico')}`.quiet().nothrow();
			expect(result.exitCode).not.toBe(0);

			const { error } = JSON.parse(result.stdout.toString());
			expect(error.code).toBe('INPUT_IS_ICO');
			expect(error.details.input).toBe(join(dir, 'favicon.ico'));
		});
	});

	describe('dispatch', () => {
		it('runs generate for a bare input path — no subcommand needed', async () => {
			const dir = await setupTmp();
			const result = await app.execute([FIXTURE, '--out-dir', dir, '--sizes', '16']);
			expect(result.exitCode).toBe(0);
			expect((await Bun.file(join(dir, 'favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
		});

		it('still routes the explicit generate name', async () => {
			const dir = await setupTmp();
			const result = await app.execute(['generate', FIXTURE, '--out-dir', dir, '--sizes', '16']);
			expect(result.exitCode).toBe(0);
			expect((await Bun.file(join(dir, 'favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
		});

		it('lists generate as the default command in root help', async () => {
			const result = await app.execute(['--help'], { help: { width: 200 } });
			expect(result.exitCode).toBe(0);

			// Stripped: ansispeck enables colour whenever CI is set, so the raw help
			// carries escapes on a runner and none locally.
			const help = strip(result.stdout.join('\n'));
			expect(help).toContain('generate (default)');
			expect(help).toContain('inject');
			expect(help).toContain('$ svg-to-ico public/icon.svg');
		});

		it('keeps suggesting a real command for a near-miss typo', async () => {
			const result = await app.execute(['injct', 'index.html']);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.join('\n')).toContain("Did you mean 'inject'?");
		});
	});

	describe('inject', () => {
		const HTML = '<html><head><title>x</title><link rel="icon" href="/old.ico"></head><body></body></html>';

		it('rewrites a single HTML file with minimal mode', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, HTML);

			const result = await runCommand(inject, [file, '--sizes', '16', '--sizes', '32']);
			expect(result.exitCode).toBe(0);

			const updated = await Bun.file(file).text();
			expect(updated).toContain('rel="icon"');
			expect(updated).toContain('href="/favicon.ico"');
			expect(updated).toContain('sizes="16x16 32x32"');
			expect(updated).not.toContain('/old.ico');
		});

		it('preserves apple-touch-icon', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(
				file,
				'<html><head><link rel="icon" href="/old.ico"><link rel="apple-touch-icon" href="/apple.png"></head></html>',
			);

			await runCommand(inject, [file]);
			const updated = await Bun.file(file).text();
			expect(updated).toContain('apple-touch-icon');
			expect(updated).not.toContain('/old.ico');
		});

		it('handles multiple files via variadic arg', async () => {
			const dir = await setupTmp();
			const a = join(dir, 'a.html');
			const b = join(dir, 'b.html');
			await Bun.write(a, '<head></head>');
			await Bun.write(b, '<head></head>');

			const result = await runCommand(inject, [a, b]);
			expect(result.exitCode).toBe(0);
			expect(await Bun.file(a).text()).toContain('/favicon.ico');
			expect(await Bun.file(b).text()).toContain('/favicon.ico');
		});

		it('honors --base', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			await runCommand(inject, [file, '--base', '/app/']);
			const updated = await Bun.file(file).text();
			expect(updated).toContain('href="/app/favicon.ico"');
		});

		it('emits SVG link when --source is provided', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			await runCommand(inject, [file, '--source', 'favicon.svg']);
			const updated = await Bun.file(file).text();
			expect(updated).toContain('type="image/svg+xml"');
			expect(updated).toContain('href="/favicon.svg"');
		});

		it('reports missing files but does not fail the run', async () => {
			const dir = await setupTmp();
			const present = join(dir, 'present.html');
			await Bun.write(present, '<head></head>');

			const result = await runCommand(inject, [present, join(dir, 'nope.html')]);
			expect(result.exitCode).toBe(0);
			const all = [...result.stdout, ...result.stderr].join('\n');
			expect(all).toContain('file not found');
			expect(await Bun.file(present).text()).toContain('/favicon.ico');
		});

		it('--embed inlines the ICO as a base64 data: URI (no file reference)', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			const icoBytes = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16]); // arbitrary ICO-ish bytes
			await Bun.write(join(dir, 'favicon.ico'), icoBytes);

			const result = await runCommand(inject, [file, '--embed']);
			expect(result.exitCode).toBe(0);

			const updated = await Bun.file(file).text();
			expect(updated).toContain(`href="data:image/x-icon;base64,${icoBytes.toString('base64')}"`);
			expect(updated).not.toContain('href="/favicon.ico"');
		});

		it('--embed --encoding utf8 inlines the SVG source as a readable data: URI', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
			await Bun.write(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

			const result = await runCommand(inject, [file, '--source', 'favicon.svg', '--embed', '--encoding', 'utf8']);
			expect(result.exitCode).toBe(0);

			const updated = await Bun.file(file).text();
			// SVG inlined as utf8, not a file reference. Bytes preserved verbatim —
			// double quotes percent-encode to %22 rather than swapping to single quotes.
			expect(updated).toContain('href="data:image/svg+xml,');
			expect(updated).toContain('xmlns=%22http://www.w3.org/2000/svg%22');
			expect(updated).not.toContain('href="/favicon.svg"');
			// ICO is always base64.
			expect(updated).toContain('href="data:image/x-icon;base64,');
		});

		it('--embed reads from --asset-dir when the assets live elsewhere', async () => {
			const dir = await setupTmp();
			const pages = join(dir, 'pages');
			await mkdir(pages, { recursive: true });
			const file = join(pages, 'index.html');
			await Bun.write(file, '<head></head>');
			const icoBytes = Buffer.from([1, 2, 3, 4]);
			await Bun.write(join(dir, 'favicon.ico'), icoBytes); // in dir, not next to the HTML

			const result = await runCommand(inject, [file, '--embed', '--asset-dir', dir]);
			expect(result.exitCode).toBe(0);
			expect(await Bun.file(file).text()).toContain(`data:image/x-icon;base64,${icoBytes.toString('base64')}`);
		});

		it('--embed fails clearly when the referenced file is missing', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>'); // no favicon.ico written

			const result = await runCommand(inject, [file, '--embed']);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.join('')).toContain('cannot read');
		});

		it('--png-sizes links the per-size PNGs generate writes', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			const result = await runCommand(inject, [file, '--sizes', '16', '--png-sizes', '192', '--png-sizes', '512']);
			expect(result.exitCode).toBe(0);

			const updated = await Bun.file(file).text();
			expect(updated).toContain('<link rel="icon" type="image/png" href="/favicon-192x192.png" sizes="192x192">');
			expect(updated).toContain('<link rel="icon" type="image/png" href="/favicon-512x512.png" sizes="512x512">');
			// The combined ICO link survives alongside them.
			expect(updated).toContain('href="/favicon.ico"');
		});

		it('emits no PNG links when --png-sizes is absent', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			await runCommand(inject, [file]);
			expect(await Bun.file(file).text()).not.toContain('image/png');
		});

		it('derives the PNG filenames from --output, matching generate', async () => {
			const dir = await setupTmp();
			await Bun.write(join(dir, 'icon.svg'), await Bun.file(FIXTURE).text());
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			const written = await runCommand(
				generate,
				[join(dir, 'icon.svg'), '-o', 'logo.ico', '--sizes', '16', '--emit-sizes', 'png'],
			);
			expect(written.exitCode).toBe(0);
			expect(await Bun.file(join(dir, 'logo-16x16.png')).exists()).toBe(true);

			await runCommand(inject, [file, '-o', 'logo.ico', '--sizes', '16', '--png-sizes', '16']);
			expect(await Bun.file(file).text()).toContain('href="/logo-16x16.png"');
		});

		it('--png-sizes honors --base', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			await runCommand(inject, [file, '--png-sizes', '192', '--base', '/repo/']);
			expect(await Bun.file(file).text()).toContain('href="/repo/favicon-192x192.png"');
		});

		it('--png-sizes with --embed inlines the PNG instead of referencing it', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
			const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
			await Bun.write(join(dir, 'favicon-192x192.png'), png);

			const result = await runCommand(inject, [file, '--png-sizes', '192', '--embed']);
			expect(result.exitCode).toBe(0);

			const updated = await Bun.file(file).text();
			expect(updated).toContain(`href="data:image/png;base64,${png.toString('base64')}"`);
			expect(updated).not.toContain('href="/favicon-192x192.png"');
		});

		it('rejects a PNG size outside 1–4096', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			const result = await runCommand(inject, [file, '--png-sizes', '8192']);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.join('')).toContain('must be <= 4096');
		});

		it('--generate-missing writes the referenced files it cannot find', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(
				inject,
				[file, '--source', 'favicon.svg', '--sizes', '16', '--png-sizes', '192', '--generate-missing'],
			);
			expect(result.exitCode).toBe(0);

			expect((await Bun.file(join(dir, 'favicon.ico')).bytes()).byteLength).toBeGreaterThan(0);
			const png = await Bun.file(join(dir, 'favicon-192x192.png')).bytes();
			expect(png[0]).toBe(0x89); // PNG magic
			expect(await Bun.file(file).text()).toContain('href="/favicon.ico"');
		});

		it('--generate-missing leaves files that already exist untouched', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), await Bun.file(FIXTURE).text());
			const existing = Buffer.from([0, 0, 1, 0, 7, 7, 7]);
			await Bun.write(join(dir, 'favicon.ico'), existing);

			await runCommand(inject, [file, '--source', 'favicon.svg', '--generate-missing']);
			expect(await Bun.file(join(dir, 'favicon.ico')).bytes()).toEqual(new Uint8Array(existing));
		});

		it('--generate-missing reports the assets it created under --json', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), await Bun.file(FIXTURE).text());

			const result = await Bun
				.$`bun ${CLI_ENTRY} --json inject ${file} --source favicon.svg --sizes 16 --generate-missing`
				.quiet()
				.nothrow();
			expect(result.exitCode).toBe(0);

			const summary = JSON.parse(result.stdout.toString());
			expect(summary.generated).toEqual([join(dir, 'favicon.ico')]);
		});

		it('reports a corrupt --source as a diagnostic, not a sharp stack trace', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), 'not an image at all');

			const result = await runCommand(inject, [file, '--source', 'favicon.svg', '--generate-missing']);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('GENERATE_MISSING');
			// The underlying sharp message survives for anyone reading --json.
			expect((result.error?.details as { reason?: string })?.reason).toContain('unsupported image format');
		});

		it('--embed surfaces a corrupt --source instead of a raw sharp error', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), 'not an image at all');

			const result = await runCommand(inject, [file, '--source', 'favicon.svg', '--embed']);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('EMBED_READ');
			expect(result.error?.suggest).toContain('unsupported image format');
		});

		it('--generate-missing refuses a target that is not a regular file', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), await Bun.file(FIXTURE).text());
			// A directory on the target path would otherwise read as "already there".
			await mkdir(join(dir, 'favicon.ico'), { recursive: true });

			const result = await runCommand(inject, [file, '--source', 'favicon.svg', '--generate-missing']);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('GENERATE_MISSING');
			expect(result.error?.message).toContain('not a regular file');
			expect(await Bun.file(file).text()).not.toContain('href=');
		});

		it('--generate-missing fails clearly with nothing to rasterize from', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			const result = await runCommand(inject, [file, '--generate-missing']);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('GENERATE_MISSING');
			expect(result.error?.suggest).toContain('--source');
		});

		it('--generate-missing rasterizes once across several HTML files', async () => {
			const dir = await setupTmp();
			const a = join(dir, 'a.html');
			const b = join(dir, 'b.html');
			await Bun.write(a, '<head></head>');
			await Bun.write(b, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(inject, [a, b, '--source', 'favicon.svg', '--generate-missing']);
			expect(result.exitCode).toBe(0);
			const wrote = result.stderr.join('\n').match(/Wrote .*favicon\.ico/g) ?? [];
			expect(wrote).toHaveLength(1);
		});

		it('--embed rasterizes a missing target from --source without writing it', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), await Bun.file(FIXTURE).text());

			const result = await runCommand(
				inject,
				[file, '--source', 'favicon.svg', '--sizes', '16', '--png-sizes', '32', '--embed'],
			);
			expect(result.exitCode).toBe(0);

			const updated = await Bun.file(file).text();
			expect(updated).toContain('href="data:image/x-icon;base64,');
			expect(updated).toContain('href="data:image/png;base64,');
			// The href carries the bytes, so no file is needed at the referenced path.
			expect(await Bun.file(join(dir, 'favicon.ico')).exists()).toBe(false);
			expect(await Bun.file(join(dir, 'favicon-32x32.png')).exists()).toBe(false);
			expect(result.stderr.join('\n')).toContain('Rasterized');
		});

		it('--embed still fails when nothing can be rasterized from', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');

			const result = await runCommand(inject, [file, '--embed']);
			expect(result.exitCode).not.toBe(0);
			expect(result.error?.code).toBe('EMBED_READ');
		});

		it('--embed prefers the file on disk over rasterizing', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			await Bun.write(file, '<head></head>');
			await Bun.write(join(dir, 'favicon.svg'), await Bun.file(FIXTURE).text());
			const icoBytes = Buffer.from([0, 0, 1, 0, 9, 9]);
			await Bun.write(join(dir, 'favicon.ico'), icoBytes);

			const result = await runCommand(inject, [file, '--source', 'favicon.svg', '--embed']);
			expect(result.exitCode).toBe(0);
			expect(await Bun.file(file).text()).toContain(`data:image/x-icon;base64,${icoBytes.toString('base64')}`);
		});

		it('reports per-file outcomes on stdout under --json', async () => {
			const dir = await setupTmp();
			const file = join(dir, 'index.html');
			const absent = join(dir, 'gone.html');
			await Bun.write(file, HTML);

			const result = await Bun.$`bun ${CLI_ENTRY} --json inject ${file} ${absent}`.quiet().nothrow();
			expect(result.exitCode).toBe(0);

			const summary = JSON.parse(result.stdout.toString());
			expect(summary.rewritten).toBe(1);
			expect(summary.files).toEqual([
				{ file, status: 'rewritten' },
				{ file: absent, status: 'missing' },
			]);
		});
	});
});
