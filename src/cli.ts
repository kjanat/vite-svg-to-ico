#!/usr/bin/env node
/**
 * # svg-to-ico
 *
 * CLI companion to the `vite-svg-to-ico` Vite plugin. Generates multi-size ICO
 * favicons from any sharp-supported source image, and/or injects favicon
 * `<link>` tags into existing HTML files.
 *
 * ## Why
 *
 * Vite's plugin pipeline ends at `closeBundle`. Frameworks that render HTML
 * outside that pipeline (SvelteKit, VitePress, Astro adapters) write the user-
 * visible HTML *after* the plugin's last hook fires, so the plugin's built-in
 * `emit.inject` silently no-ops. This CLI runs as a `"postbuild"` step against
 * the framework's final on-disk HTML, sidestepping the hook-ordering trap.
 *
 * The CLI is also useful for non-Vite pipelines: a one-off ICO generator that
 * shares the plugin's emit logic (sharp + ICO packer) without dragging Vite
 * into the equation. Global install with `bun i -g vite-svg-to-ico` (or
 * `npm i -g vite-svg-to-ico`) puts `svg-to-ico` on PATH.
 *
 * ## Subcommands
 *
 * - `generate <input>` — rasterize an image to a multi-size ICO (and
 *   optionally per-size PNGs/ICOs + a copy of the source) on disk.
 * - `inject <files...>` — rewrite existing HTML files: strip
 *   `<link rel="icon">`/`<link rel="shortcut icon">` tags, splice the
 *   configured favicon tag set before `</head>`, preserve `apple-touch-icon`.
 *
 * @example
 * ```sh
 * # SvelteKit adapter-static, wired into package.json scripts:
 * #   "build": "vite build && svg-to-ico inject build/index.html build/404.html -s 16 -s 32 -s 48 --source favicon.svg"
 *
 * # Generate a 16/32/48 ICO + per-size PNGs alongside it:
 * svg-to-ico generate src/icon.svg --out-dir build -s 16 -s 32 -s 48 --emit-sizes png --emit-source
 *
 * # Inject favicon links into multiple HTML files at once:
 * svg-to-ico inject dist/index.html dist/404.html -s 16 -s 32 -s 48 --source favicon.svg --base /app/
 * ```
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { arg, cli, CLIError, command, flag } from '@kjanat/dreamcli';

import { buildFaviconTags, injectTagsIntoHtml } from './html.ts';
import { generateSizedPngs, packIco } from './ico.ts';
import { INJECT_MODES, type InjectMode } from './types.ts';

/** Validate each size is an integer in [1, 256] (ICO spec) and that the list is non-empty. */
function validateSizes(sizes: number[]): number[] {
	if (sizes.length === 0) {
		throw new CLIError('`--sizes` must contain at least one value', { code: 'INVALID_ARGUMENT' });
	}
	for (const n of sizes) {
		if (!Number.isInteger(n) || n < 1 || n > 256) {
			throw new CLIError(`Invalid size: ${n}. Must be an integer 1–256.`, { code: 'INVALID_ARGUMENT' });
		}
	}
	return sizes;
}

export const generate = command('generate')
	.description(
		'Rasterize a source image into a multi-size ICO favicon. Optionally also emit per-size '
			+ 'PNG/ICO files and a copy of the original source. Equivalent to what the Vite plugin '
			+ 'emits during `vite build`, but runs standalone.',
	)
	.arg(
		'input',
		arg.string().describe(
			'Path to source image. Sharp-supported formats: .svg, .svgz, .png, .jpg/.jpeg, .webp, .avif, .gif, .tif/.tiff.',
		),
	)
	.flag(
		'output',
		flag.string().alias('o').default('favicon.ico').describe(
			'Filename for the combined ICO (relative to --out-dir). May include subdirectories; they are created as needed.',
		),
	)
	.flag(
		'sizes',
		flag.array(flag.number()).alias('s').default([16, 32, 48]).describe(
			'Pixel sizes to rasterize (integers 1–256). Pass repeated: `-s 16 -s 32 -s 48`.',
		),
	)
	.flag(
		'out-dir',
		flag.string().alias('d').default('.').describe('Directory to write outputs into. Created if missing.'),
	)
	.flag(
		'emit-sizes',
		flag.enum(['none', 'png', 'ico', 'both']).default('none').describe(
			'Emit per-size files alongside the combined ICO: `png` (favicon-NxN.png), `ico` (favicon-NxN.ico), `both`, or `none`.',
		),
	)
	.flag(
		'emit-source',
		flag.boolean().default(false).describe(
			'Copy the original source image into --out-dir (preserves its original basename).',
		),
	)
	.flag(
		'no-optimize',
		flag.boolean().default(false).describe(
			'Skip max PNG compression. Faster builds, larger files. (Default: compression level 9 + adaptive filtering.)',
		),
	)
	.example('svg-to-ico generate src/icon.svg', 'Write favicon.ico (16/32/48) to the current directory.')
	.example(
		'svg-to-ico generate src/icon.svg -d build -s 16 -s 32 -s 48 --emit-sizes png --emit-source',
		'Generate ICO + per-size PNGs + copy of source into build/.',
	)
	.example(
		'svg-to-ico generate src/icon.png -s 64 -s 128 -s 256 -o icons/favicon.ico',
		'PNG input, custom sizes, nested output path.',
	)
	.action(async ({ args, flags, out }) => {
		const sizes = validateSizes(flags.sizes);
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
	.description(
		'Rewrite existing HTML files on disk: strip `<link rel="icon">` and `<link rel="shortcut icon">` '
			+ 'tags (preserves `apple-touch-icon`), splice in the configured favicon tag set before `</head>`, '
			+ 'and write back. The ICO/SVG files themselves are expected to already exist at the configured paths.',
	)
	.arg(
		'files',
		arg.string().variadic().describe(
			'HTML file paths to rewrite (one or more). Missing files emit a warning and are skipped, '
				+ 'but do not fail the run.',
		),
	)
	.flag(
		'output',
		flag.string().alias('o').default('favicon.ico').describe(
			"ICO filename referenced in the injected `<link>` (matches `generate`'s --output).",
		),
	)
	.flag(
		'sizes',
		flag.array(flag.number()).alias('s').default([16, 32, 48]).describe(
			'Pixel sizes baked into the `sizes="…"` attribute (must match the ICO\'s actual contents). '
				+ 'Pass repeated: `-s 16 -s 32 -s 48`.',
		),
	)
	.flag(
		'mode',
		flag.enum(INJECT_MODES).alias('m').default('minimal').describe(
			'Tag set to inject. `minimal`: ICO + optional SVG source link. `full`: also per-size PNG/ICO links.',
		),
	)
	.flag(
		'base',
		flag.string().default('/').describe(
			"URL base prefix for hrefs (matches Vite's `base` config). Trailing slash is optional; "
				+ '`--base /app` and `--base /app/` both yield `/app/favicon.ico`.',
		),
	)
	.flag(
		'source',
		flag.string().describe(
			'Filename of the source file (e.g. `favicon.svg`). When set, an additional '
				+ '`<link rel="icon" type="image/svg+xml">` tag is injected.',
		),
	)
	.flag(
		'input-format',
		flag.string().default('svg').describe(
			'Format of `--source` for the MIME type attribute. One of: svg, png, jpg, webp, avif, gif, tiff.',
		),
	)
	.example(
		'svg-to-ico inject build/index.html',
		'Inject default favicon.ico tag (16/32/48) into a single file.',
	)
	.example(
		'svg-to-ico inject build/index.html build/404.html -s 16 -s 32 -s 48 --source favicon.svg',
		'Multi-file rewrite, also injects SVG source `<link>`.',
	)
	.example(
		'svg-to-ico inject dist/index.html --base /repo/ -m full',
		'Full tag set under a subpath base (e.g. GitHub Pages project site).',
	)
	.action(async ({ args, flags, out }) => {
		const files = args.files;
		if (files.length === 0) {
			throw new CLIError('At least one HTML file path is required', { code: 'INVALID_ARGUMENT' });
		}
		const sizes = validateSizes(flags.sizes);
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
