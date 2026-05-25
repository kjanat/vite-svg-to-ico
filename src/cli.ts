#!/usr/bin/env node
/**
 * # svg-to-ico
 *
 * CLI companion to the `vite-svg-to-ico` Vite plugin.
 * Generates multi-size ICO favicons from any sharp-supported source image,
 * and/or injects favicon `<link>` tags into existing HTML files.
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
import { dirname, resolve } from 'node:path';
import { cwd } from 'node:process';

import { arg, cli, CLIError, command, flag } from '@kjanat/dreamcli';

import pkg from '#pkg';
import { buildFaviconTags, injectTagsIntoHtml } from './html.ts';
import { generateSizedPngs, packIco } from './ico.ts';
import { inputBasename, isHttpUrl, loadInputBytes, normalizeInput } from './load-input.ts';
import { INJECT_MODES, type InjectMode } from './types.ts';

/**
 * Build the `--sizes` flag: an array of per-element-validated integers, each
 * restricted to `[1, 256]` per the ICO spec. Parsing and range-check live
 * inside the flag definition so the action handler can trust the value.
 */
const sizesFlag = () =>
	flag.array(flag.custom<number>((raw) => {
		const n = typeof raw === 'number' ? raw : Number(raw);
		if (!Number.isInteger(n) || n < 1 || n > 256) {
			throw new CLIError(`Invalid size: ${String(raw)}. Must be an integer 1–256.`, { code: 'INVALID_SIZE' });
		}
		return n;
	}))
		.alias('s')
		.default([16, 32, 48])
		.describe('Pixel sizes (integers 1–256). Pass repeated: `-s16 -s32 -s48`.');

/** Resolve a raw string to an absolute filesystem path (relative to CWD). */
const toAbsolutePath = (raw: unknown): string => resolve(String(raw));

/**
 * Source-input arg. Accepts filesystem paths (resolved to absolute),
 * `file://` URL strings (converted to paths, then resolved), and `http(s)://`
 * URL strings (passed through; fetched at action time by {@link loadInputBytes}).
 */
const sourceArg = () =>
	arg.custom<string>((raw) => {
		const s = normalizeInput(String(raw));
		return isHttpUrl(s) ? s : resolve(s);
	});

/** Reusable absolute-path flag: parsing happens at the schema layer. */
const pathFlag = () => flag.custom<string>(toAbsolutePath);

/**
 * `generate` subcommand: rasterize a source image into a multi-size ICO favicon.
 * Optionally also emits per-size PNG/ICO files and a copy of the source.
 *
 * Exported so consumers can compose it into their own `@kjanat/dreamcli` CLI
 * or unit-test it directly via `runCommand(generate, [...])` from
 * `@kjanat/dreamcli/testkit`.
 */
export const generate = command('generate')
	.description(
		'Rasterize a source image into a multi-size ICO favicon. Optionally also emit per-size '
			+ 'PNG/ICO files and a copy of the original source. Equivalent to what the Vite plugin '
			+ 'emits during `vite build`, but runs standalone.',
	)
	.arg(
		'input',
		sourceArg().describe(
			'Path, `file://` URL, or `http(s)://` URL to source image. Paths and `file://` URLs are '
				+ 'resolved to absolute; `http(s)://` URLs are fetched at run time. Sharp-supported '
				+ 'formats: .svg, .svgz, .png, .jpg/.jpeg, .webp, .avif, .gif, .tif/.tiff.',
		),
	)
	.flag(
		'output',
		flag.string().alias('o').default('favicon.ico').describe(
			'Filename for the combined ICO (relative to --out-dir). May include subdirectories; they are created as needed.',
		),
	)
	.flag('sizes', sizesFlag())
	.flag(
		'out-dir',
		pathFlag().alias('d').default(cwd()).describe(
			'Directory to write outputs into (resolved to absolute). Created if missing. '
				+ 'Defaults to the current working directory.',
		),
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
		'optimize',
		flag.boolean().default(true).describe(
			'Apply max PNG compression (level 9 + adaptive filtering). Disable with `--optimize=false` for '
				+ 'faster builds at the cost of larger files.',
		),
	)
	.example('generate src/icon.svg', 'Write favicon.ico (16/32/48) to the current directory.')
	.example(
		'generate src/icon.svg -d build -s16 -s32 -s48 --emit-sizes png --emit-source',
		'Generate ICO + per-size PNGs + copy of source into build/.',
	)
	.example(
		'generate src/icon.png -s64 -s128 -s256 -o icons/favicon.ico',
		'PNG input, custom sizes, nested output path.',
	)
	.action(async ({ args, flags, out }) => {
		const sizes = flags.sizes;
		const input = args.input;
		const outDir = flags['out-dir'];
		const outputStem = flags.output.replace(/\.ico$/i, '');

		const inputBuffer = await loadInputBytes(input);
		const pngs = await generateSizedPngs(inputBuffer, {
			sizes,
			optimize: flags.optimize,
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
			const sourcePath = resolve(outDir, inputBasename(input));
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

/**
 * `inject` subcommand: rewrite existing HTML files on disk to include the
 * configured favicon `<link>` tag set. Strips existing icon links,
 * preserves `apple-touch-icon`, splices new tags before `</head>`.
 *
 * Exported for composition and `runCommand(inject, [...])` testing.
 */
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
	.flag('sizes', sizesFlag())
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
		flag.enum(['svg', 'png', 'jpg', 'webp', 'avif', 'gif', 'tiff']).default('svg').describe(
			'Format of `--source` for the MIME type attribute. Only `svg` triggers the SVG `<link>`; '
				+ 'other values are accepted but currently inert in tag generation.',
		),
	)
	.example(
		'inject build/index.html',
		'Inject default favicon.ico tag (16/32/48) into a single file.',
	)
	.example(
		'inject build/index.html build/404.html -s16 -s32 -s48 --source favicon.svg',
		'Multi-file rewrite, also injects SVG source `<link>`.',
	)
	.example(
		'inject dist/index.html --base /repo/ -m full',
		'Full tag set under a subpath base (e.g. GitHub Pages project site).',
	)
	.action(async ({ args, flags, out }) => {
		const files = args.files;
		if (files.length === 0) {
			throw new CLIError('At least one HTML file path is required', { code: 'MISSING_FILES' });
		}
		const sizes = flags.sizes;
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

/**
 * Top-level `svg-to-ico` CLI: bundles {@link generate} and {@link inject}
 * subcommands plus shell-completion generation.
 */
export const app = cli('svg-to-ico')
	// `pkg.version` is bundled at build time via the `#pkg` subpath import.
	// `.version()` is stable across all dreamcli versions, no patch required.
	.version(pkg.version)
	.description('Generate ICO favicons and inject <link> tags into HTML files')
	.command(generate)
	.command(inject)
	.completions();

if (import.meta.main) {
	void app.run();
}
