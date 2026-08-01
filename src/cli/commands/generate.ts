import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cwd } from 'node:process';
import { pathToFileURL } from 'node:url';
import { blue, green, red } from 'ansispeck';
import { command, flag } from 'dreamcli';
import { assertReadableSource, source } from '#cli/args/source';
import { sizesFlag } from '#cli/flags/sizes';
import { packIco } from '#ico';
import { inputBasename, isHttpUrl, loadInputBytes } from '#loadInput';
import { generateSizedPngs } from '#raster';

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
		`\
Rasterize a source image into a multi-size ICO favicon. \
Optionally also emit per-size PNG/ICO files and a copy of the original source. \
Equivalent to what the Vite plugin emits during ${blue('vite build')}, but runs standalone.`,
	)
	.arg(
		'input',
		source().describe(
			`\
Path, ${red('file://')} URL, or ${red('http(s)://')} URL to source image. \
Paths and ${red('file://')} URLs are resolved to absolute; \
${red('http(s)://')} URLs are fetched at run time. \
Sharp-supported formats: ${blue('.svg')}, ${blue('.svgz')}, ${blue('.png')}, ${blue('.jpg')}/${blue('.jpeg')}, ${
				blue(
					'.webp',
				)
			}, ${blue('.avif')}, ${blue('.gif')}, ${blue('.tif')}/${blue('.tiff')}.`,
		),
	)
	.flag(
		'output',
		flag
			.string()
			.nonEmpty()
			.alias('o')
			.default('favicon.ico')
			.describe(
				`Filename for the combined ICO (relative to ${
					blue('--out-dir')
				}). May include subdirectories; they are created as needed.`,
			),
	)
	.flag('sizes', sizesFlag())
	.flag(
		'out-dir',
		flag
			.path()
			.alias('d')
			.describe(
				`Directory to write outputs into. Relative paths resolve from the current working directory. Created if missing. Defaults to the source image's own directory; ${
					red('http(s)://')
				} sources fall back to the current directory.`,
			),
	)
	.flag(
		'emit-sizes',
		flag
			.enum(['none', 'png', 'ico', 'both'])
			.default('none')
			.describe(
				`Emit per-size files alongside the combined ICO: ${red('png')} (favicon-NxN.png), ${
					red('ico')
				} (favicon-NxN.ico), ${red('both')}, or ${red('none')}.`,
			),
	)
	.flag(
		'emit-source',
		flag
			.boolean()
			.default(false)
			.describe(`Copy the original source image into ${blue('--out-dir')} (preserves its original basename).`),
	)
	.flag(
		'optimize',
		flag
			.boolean()
			.default(true)
			.negatable()
			.describe(
				'Apply max PNG compression (level 9 + adaptive filtering). Disabling it builds faster at the cost of larger files.',
			),
	)
	.example(
		(meta) => green(`${meta.name} public/icon.svg`),
		'Write public/favicon.ico (16/32/48) beside the source',
	)
	.example(
		(meta) => green(`${meta.name} generate src/icon.svg -d build -s16 -s32 -s48 --emit-sizes png --emit-source`),
		'Generate ICO + per-size PNGs + copy of source into build/',
	)
	.example(
		(meta) => green(`${meta.name} generate src/icon.png -s64 -s128 -s256 -o icons/favicon.ico`),
		'PNG input, custom sizes, nested output path',
	)
	.action(async ({ args, flags, out }) => {
		const sizes = flags.sizes;
		const input = args.input;
		// Outputs belong beside the image they came from, not in whatever directory
		// the shell happens to be in. Remote sources have no local directory to sit
		// beside, so they fall back to the cwd.
		const outDir = flags['out-dir'] ?? (isHttpUrl(input) ? cwd() : dirname(input));
		const outputStem = flags.output.replace(/\.ico$/i, '');
		const { color: c } = out;

		await assertReadableSource(input);
		const inputBuffer = await loadInputBytes(input);
		const pngs = await generateSizedPngs(inputBuffer, {
			sizes,
			optimize: flags.optimize,
		});
		const icoBuffer = packIco(pngs);

		await mkdir(outDir, { recursive: true });

		/** Every path written, in write order — the payload behind `--json`. */
		const written: string[] = [];

		async function writeAt(targetPath: string, data: Buffer | string, detail?: string) {
			await mkdir(dirname(targetPath), { recursive: true });
			await writeFile(targetPath, data);
			written.push(targetPath);
			// status(), not log(): a progress note belongs on stderr so stdout stays
			// pipeable, and it is what `--quiet` suppresses.
			const linkedPath = c.link(pathToFileURL(targetPath), c.cyan(targetPath));
			out.status(`${c.green('Wrote')} ${linkedPath}${detail ? ` ${c.dim(detail)}` : ''}`);
		}

		const icoPath = resolve(outDir, flags.output);
		await writeAt(
			icoPath,
			icoBuffer,
			`(${icoBuffer.length} B, ${sizes.length} size${sizes.length === 1 ? '' : 's'})`,
		);

		if (flags['emit-source']) {
			const sourcePath = resolve(outDir, inputBasename(input));
			// Rewriting the source with its own bytes gains nothing and risks
			// truncating it if the write is interrupted.
			if (sourcePath === input) {
				out.status(`${c.dim('Skipped')} ${c.cyan(sourcePath)} ${c.dim('(source already in the output directory)')}`);
			} else {
				await writeAt(sourcePath, inputBuffer, '(source)');
			}
		}

		const emitSizes = flags['emit-sizes'];
		if (emitSizes !== 'none') {
			for (const png of pngs) {
				if (emitSizes === 'png' || emitSizes === 'both') {
					const p = resolve(outDir, `${outputStem}-${png.size}x${png.size}.png`);
					await writeAt(p, png.buffer);
				}
				if (emitSizes === 'ico' || emitSizes === 'both') {
					const p = resolve(outDir, `${outputStem}-${png.size}x${png.size}.ico`);
					await writeAt(p, packIco([png]));
				}
			}
		}

		if (out.jsonMode) out.json({ input, ico: icoPath, sizes, bytes: icoBuffer.length, files: written });
	});
