import { blue, green, red } from '#cli/colors';
import { pathFlag } from '#cli/flags/path';
import { sizesFlag } from '#cli/flags/sizes';
import { toDataUri } from '#dataUri';
import { buildFaviconTags, type TagContext } from '#faviconTags';
import { injectTagsIntoHtml } from '#injectHtml';
import { resolveSpecs } from '#resolveSpecs';
import type { EmitSpec } from '#types';
import { DATA_URI_ENCODINGS, INJECT_MODES } from '#types';
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
  .flag(
    'embed',
    flag
      .boolean()
      .default(false)
      .describe(
        `Inline the favicon bytes as ${blue('data:')} URIs instead of URL hrefs — the ${blue('<link>')} carries the image itself, no file reference. Reads the referenced files from ${blue('--asset-dir')}.`,
      ),
  )
  .flag(
    'encoding',
    flag
      .enum(DATA_URI_ENCODINGS)
      .default('base64')
      .describe(
        `Encoding for an embedded SVG ${blue('--source')}: ${red('base64')} or ${red('utf8')} (smaller, human-readable). Binary ICO is always ${red('base64')}. Only applies with ${blue('--embed')}.`,
      ),
  )
  .flag(
    'asset-dir',
    pathFlag().describe(
      `Directory to read favicon files from when ${blue('--embed')} is set. Defaults to each HTML file's own directory.`,
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
  .example(
    green('inject dist/index.html --source favicon.svg --embed --encoding utf8'),
    'Inline the ICO + SVG straight into the HTML as data: URIs (no file references).',
  )
  .action(async ({ args, flags, out }) => {
    const { error, log } = out;
    const files = args.files;
    if (files.length === 0) {
      throw new CLIError('At least one HTML file path is required', { code: 'MISSING_FILES' });
    }
    const sourceName = flags.source;
    // Build the same spec model the plugin uses, then resolve to injections.
    const specs: EmitSpec[] = [{ format: 'ico', sizes: flags.sizes, filename: flags.output, inject: true }];
    if (sourceName) specs.push({ format: 'svg', filename: sourceName, inject: true });
    const { injections } = resolveSpecs(specs, { inputFormat: flags['input-format'] });

    /**
     * Read the favicon files an embed run needs (ICO, plus the SVG source if
     * set) from `assetDir`, returning a {@link TagContext} embed resolver that
     * inlines them by filename. Throws a clear error if a referenced file is missing.
     */
    async function embedResolverFor(assetDir: string): Promise<NonNullable<TagContext['embed']>> {
      const names = sourceName ? [flags.output, sourceName] : [flags.output];
      const bytesByName = new Map<string, Buffer>();
      for (const name of names) {
        const path = resolve(assetDir, name);
        try {
          bytesByName.set(name, await readFile(path));
        } catch (e) {
          throw new CLIError(`inject --embed: cannot read "${name}" at ${path}: ${(e as Error).message}`, {
            code: 'EMBED_READ',
          });
        }
      }
      return (inj) => {
        if (inj.href.kind !== 'file') return undefined;
        const bytes = bytesByName.get(inj.href.filename);
        if (!bytes) return undefined; // not pre-read → leave the URL href untouched
        return toDataUri(bytes, inj.type, inj.type === 'image/svg+xml' ? flags.encoding : 'base64');
      };
    }

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
      // Embedded hrefs read assets per file (default: the HTML's own directory).
      const embed = flags.embed ? await embedResolverFor(flags['asset-dir'] ?? dirname(abs)) : undefined;
      const tags = await buildFaviconTags(injections, { base: flags.base, embed });
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
