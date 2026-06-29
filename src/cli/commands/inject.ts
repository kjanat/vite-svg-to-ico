import { blue, green, red } from '#cli/colors';
import { sizesFlag } from '#cli/flags/sizes';
import { buildFaviconTags, injectTagsIntoHtml } from '#html';
import { INJECT_MODES } from '#types';
import { arg, CLIError, command, flag } from '@kjanat/dreamcli';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * `inject` subcommand: rewrite existing HTML files on disk to include the
 * configured favicon `<link>` tag set. Strips existing icon links,
 * preserves `apple-touch-icon`, splices new tags before `</head>`.
 *
 * Exported for composition and `runCommand(inject, [...])` testing.
 */
export const inject = command('inject')
  .description(
    `Rewrite existing HTML files on disk: strip ${blue('<link rel="') + red('icon') + blue('">')} and ${
      blue('<link rel="') + red('shortcut icon') + blue('">')
    } tags (preserves ${red('apple-touch-icon')}), splice in the configured favicon tag set before ${blue(
      '</head>',
    )}, and write back. The ICO/SVG files themselves are expected to already exist at the configured paths.`,
  )
  .arg(
    'files',
    arg
      .string()
      .variadic()
      .describe(
        'HTML file paths to rewrite (one or more). Missing files emit a warning and are skipped, but do not fail the run.',
      ),
  )
  .flag(
    'output',
    flag
      .string()
      .alias('o')
      .default('favicon.ico')
      .describe(
        `ICO filename referenced in the injected ${blue('<link>')} (matches ${blue('generate')}'s ${blue('--output')}).`,
      ),
  )
  .flag('sizes', sizesFlag())
  .flag(
    'mode',
    flag
      .enum(INJECT_MODES)
      .alias('m')
      .default('minimal')
      .describe(
        `Tag set to inject. ${red('minimal')}: ICO + optional SVG source link. ${red('full')}: also per-size PNG/ICO links.`,
      ),
  )
  .flag(
    'base',
    flag
      .string()
      .default('/')
      .describe(
        `URL base prefix for hrefs (matches Vite's ${blue('base')} config). Trailing slash is optional; ${blue('--base /app')} and ${blue('--base /app/')} both yield ${red('/app/favicon.ico')}.`,
      ),
  )
  .flag(
    'source',
    flag
      .string()
      .describe(
        `Filename of the source file (e.g. ${blue('favicon.svg')}). When set, an additional ${
          blue('<link rel="') + red('icon') + blue('" type="') + red('image/svg+xml') + blue('">')
        } tag is injected.`,
      ),
  )
  .flag(
    'input-format',
    flag
      .enum(['svg', 'png', 'jpg', 'webp', 'avif', 'gif', 'tiff'])
      .default('svg')
      .describe(
        `Format of ${blue('--source')} for the MIME type attribute. Only ${red('svg')} triggers the SVG ${blue('<link>')}; other values are accepted but currently inert in tag generation.`,
      ),
  )
  .example(green('inject build/index.html'), 'Inject default favicon.ico tag (16/32/48) into a single file.')
  .example(
    green('inject build/index.html build/404.html -s16 -s32 -s48 --source favicon.svg'),
    `Multi-file rewrite, also injects SVG source ${blue('<link>')}.`,
  )
  .example(
    green('inject dist/index.html --base /repo/ -m full'),
    'Full tag set under a subpath base (e.g. GitHub Pages project site).',
  )
  .action(async ({ args, flags, out }) => {
    const { error, log } = out;
    const files = args.files;
    if (files.length === 0) {
      throw new CLIError('At least one HTML file path is required', { code: 'MISSING_FILES' });
    }
    const sizes = flags.sizes;
    const mode = flags.mode;
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
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          error(`inject: "${rel}" — file not found at ${abs}, skipping`);
          continue;
        }
        throw e;
      }
      const next = injectTagsIntoHtml(original, tags);
      if (next !== original) {
        const dir = dirname(abs);
        await mkdir(dir, { recursive: true });
        await writeFile(abs, next, 'utf8');
        rewritten++;
        log(`Rewrote ${rel}`);
      } else {
        log(`Unchanged ${rel}`);
      }
    }

    if (rewritten === 0 && files.length > 0) {
      log('No files were modified.');
    }
  });
