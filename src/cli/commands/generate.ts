import { source } from '#cli/args/source';
import { blue, green, red } from '#cli/colors';
import { pathFlag } from '#cli/flags/path';
import { sizesFlag } from '#cli/flags/sizes';
import { packIco } from '#ico';
import { generateSizedPngs } from '#raster';
import { inputBasename, loadInputBytes } from '#loadInput';
import { command, flag } from '@kjanat/dreamcli';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
    `Rasterize a source image into a multi-size ICO favicon. Optionally also emit per-size PNG/ICO files and a copy of the original source. Equivalent to what the Vite plugin emits during ${blue('vite build')}, but runs standalone.`,
  )
  .arg(
    'input',
    source().describe(
      `\
Path, ${red('file://')} URL, or ${red('http(s)://')} URL to source image. \
Paths and ${red('file://')} URLs are resolved to absolute; \
${red('http(s)://')} URLs are fetched at run time. \
Sharp-supported formats: ${blue('.svg')}, ${blue('.svgz')}, ${blue('.png')}, ${blue('.jpg')}/${blue('.jpeg')}, ${blue(
        '.webp',
      )}, ${blue('.avif')}, ${blue('.gif')}, ${blue('.tif')}/${blue('.tiff')}.`,
    ),
  )
  .flag(
    'output',
    flag
      .string()
      .alias('o')
      .default('favicon.ico')
      .describe(
        `Filename for the combined ICO (relative to ${blue('--out-dir')}). May include subdirectories; they are created as needed.`,
      ),
  )
  .flag('sizes', sizesFlag())
  .flag(
    'out-dir',
    pathFlag()
      .alias('d')
      .default('.')
      .describe(
        'Directory to write outputs into. Relative paths resolve from the current working directory. Created if missing. Defaults to the current working directory.',
      ),
  )
  .flag(
    'emit-sizes',
    flag
      .enum(['none', 'png', 'ico', 'both'])
      .default('none')
      .describe(
        `Emit per-size files alongside the combined ICO: ${red('png')} (favicon-NxN.png), ${red('ico')} (favicon-NxN.ico), ${red('both')}, or ${red('none')}.`,
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
      .describe(
        `Apply max PNG compression (level 9 + adaptive filtering). Disable with ${blue('--optimize')}=${red('false')} for faster builds at the cost of larger files.`,
      ),
  )
  .example(green('generate src/icon.svg'), 'Write favicon.ico (16/32/48) to the current directory.')
  .example(
    green('generate src/icon.svg -d build -s16 -s32 -s48 --emit-sizes png --emit-source'),
    'Generate ICO + per-size PNGs + copy of source into build/.',
  )
  .example(
    green('generate src/icon.png -s64 -s128 -s256 -o icons/favicon.ico'),
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
