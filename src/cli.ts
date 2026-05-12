#!/usr/bin/env node
/**
 * vite-svg-to-ico CLI — generate ICO favicons and inject `<link>` tags into
 * HTML files outside of a Vite plugin context.
 *
 * Useful when the host framework writes HTML outside Vite's pipeline
 * (SvelteKit, VitePress, Astro adapters), so the plugin's `transformIndexHtml`
 * never sees the final HTML. Wire as a `"postbuild"` script in `package.json`.
 *
 * @example
 * ```sh
 * svg-to-ico generate src/icon.svg --out-dir build --sizes 16,32,48
 * svg-to-ico inject build/index.html build/404.html --sizes 16,32,48
 *
 * Bundled with `vite-svg-to-ico`. The binary is named `svg-to-ico`
 * because it is not Vite-specific — global install (`bun add -g
 * vite-svg-to-ico`) makes it available on PATH for any HTML pipeline.
 * ```
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { arg, cli, CLIError, command, flag } from '@kjanat/dreamcli';

import { buildFaviconTags, injectTagsIntoHtml } from './html.ts';
import { generateSizedPngs, packIco } from './ico.ts';
import { INJECT_MODES, type InjectMode } from './types.ts';

/** Parse comma-separated integer list, validating each is 1–256 per the ICO spec. */
function parseSizes(raw: string): number[] {
	const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
	if (parts.length === 0) {
		throw new CLIError('`sizes` must contain at least one value', { code: 'INVALID_ARGUMENT' });
	}
	return parts.map((p) => {
		const n = Number(p);
		if (!Number.isInteger(n) || n < 1 || n > 256) {
			throw new CLIError(`Invalid size: "${p}". Must be an integer 1–256.`, { code: 'INVALID_ARGUMENT' });
		}
		return n;
	});
}

export const generate = command('generate')
	.description('Generate a multi-size ICO favicon (and optional per-size PNGs) from an image source')
	.arg('input', arg.string().describe('Path to source image (.svg, .png, .jpg, .webp, .avif, .gif, .tiff)'))
	.flag('output', flag.string().alias('o').default('favicon.ico').describe('Output ICO filename'))
	.flag('sizes', flag.string().alias('s').default('16,32,48').describe('Comma-separated pixel sizes (1–256)'))
	.flag('out-dir', flag.string().alias('d').default('.').describe('Directory to write outputs into'))
	.flag(
		'emit-sizes',
		flag.enum(['none', 'png', 'ico', 'both']).default('none').describe(
			'Also emit per-size files: png, ico, both, or none',
		),
	)
	.flag('emit-source', flag.boolean().default(false).describe('Copy the source file alongside the ICO'))
	.flag('no-optimize', flag.boolean().default(false).describe('Disable max PNG compression'))
	.action(async ({ args, flags, out }) => {
		const sizes = parseSizes(flags.sizes);
		const inputPath = resolve(args.input);
		const outDir = resolve(flags['out-dir']);
		const outputStem = flags.output.replace(/\.ico$/i, '');

		const inputBuffer = await readFile(inputPath);
		const pngs = await generateSizedPngs(inputBuffer, {
			sizes,
			optimize: !flags['no-optimize'],
		});
		const icoBuffer = packIco(pngs);

		await mkdir(outDir, { recursive: true });

		async function writeAt(targetPath: string, data: Buffer | string, label: string) {
			await mkdir(dirname(targetPath), { recursive: true });
			await writeFile(targetPath, data);
			out.log(label);
		}

		const icoPath = resolve(outDir, flags.output);
		await writeAt(
			icoPath,
			icoBuffer,
			`Wrote ${icoPath} (${icoBuffer.length} B, ${sizes.length} size${sizes.length === 1 ? '' : 's'})`,
		);

		if (flags['emit-source']) {
			const sourcePath = resolve(outDir, basename(inputPath));
			await writeAt(sourcePath, inputBuffer, `Wrote ${sourcePath} (source)`);
		}

		const emitSizes = flags['emit-sizes'];
		if (emitSizes !== 'none') {
			for (const png of pngs) {
				if (emitSizes === 'png' || emitSizes === 'both') {
					const p = resolve(outDir, `${outputStem}-${png.size}x${png.size}.png`);
					await writeAt(p, png.buffer, `Wrote ${p}`);
				}
				if (emitSizes === 'ico' || emitSizes === 'both') {
					const p = resolve(outDir, `${outputStem}-${png.size}x${png.size}.ico`);
					await writeAt(p, packIco([png]), `Wrote ${p}`);
				}
			}
		}
	});

export const inject = command('inject')
	.description('Inject favicon `<link>` tags into existing HTML files (strips existing icon links)')
	.arg('files', arg.string().variadic().describe('HTML file paths to rewrite'))
	.flag('output', flag.string().alias('o').default('favicon.ico').describe('ICO filename to reference'))
	.flag('sizes', flag.string().alias('s').default('16,32,48').describe('Comma-separated pixel sizes used in the ICO'))
	.flag('mode', flag.enum(INJECT_MODES).alias('m').default('minimal').describe('Tag set to inject'))
	.flag('base', flag.string().default('/').describe('URL base prefix for hrefs (matches Vite `base`)'))
	.flag(
		'source',
		flag.string().describe('Filename of the emitted source file, enables the SVG `<link>` (e.g. favicon.svg)'),
	)
	.flag(
		'input-format',
		flag.string().default('svg').describe('Source format for MIME type on the SVG `<link>` (svg, png, jpg, ...)'),
	)
	.action(async ({ args, flags, out }) => {
		const files = args.files;
		if (files.length === 0) {
			throw new CLIError('At least one HTML file path is required', { code: 'INVALID_ARGUMENT' });
		}
		const sizes = parseSizes(flags.sizes);
		const mode = flags.mode as InjectMode;
		const sourceName = flags.source;
		const tags = buildFaviconTags({
			output: flags.output,
			sizes,
			sourceEmitted: !!sourceName,
			sourceName: sourceName ?? '',
			inputFormat: flags['input-format'],
			mode,
			base: flags.base,
		});

		let rewritten = 0;
		for (const rel of files) {
			const abs = resolve(rel);
			let original: string;
			try {
				original = await readFile(abs, 'utf8');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					out.error(`inject: "${rel}" — file not found at ${abs}, skipping`);
					continue;
				}
				throw error;
			}
			const next = injectTagsIntoHtml(original, tags);
			if (next !== original) {
				const dir = dirname(abs);
				await mkdir(dir, { recursive: true });
				await writeFile(abs, next, 'utf8');
				rewritten++;
				out.log(`Rewrote ${rel}`);
			} else {
				out.log(`Unchanged ${rel}`);
			}
		}

		if (rewritten === 0 && files.length > 0) {
			out.log('No files were modified.');
		}
	});

export const app = cli('svg-to-ico')
	.description('Generate ICO favicons and inject <link> tags into HTML files')
	.command(generate)
	.command(inject)
	.completions();

if (import.meta.main) {
	void app.run();
}
