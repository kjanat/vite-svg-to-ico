import { resolve } from 'node:path';

import { parseConfig } from '#config';
import { toDataUri } from '#dataUri';
import { INJECT_ICON_LINK_RE } from '#injectHtml';
import { packIco } from '#ico';
import { DEBUG, Instrumentation } from '#instrumentation';
import { loadInputBytes } from '#loadInput';
import type { GenerateOptions, SizedPng } from '#raster';
import { generateSizedPngs } from '#raster';
import { type ResolvedFile, type ResolvedInjection, resolveSpecs } from '#resolveSpecs';
import type {
  DevInjection,
  DevOptions,
  EmitFormat,
  EmitSpec,
  IconSize,
  IcoSpec,
  InjectMode,
  PluginOptions,
  PngSpec,
  SharpOptions,
  SvgSpec,
} from '#types';

import type { Connect, HtmlTagDescriptor, Plugin } from 'vite';

/**
 * Public type surface re-exported from `./types.ts` (plus `GenerateOptions`
 * from `./raster.ts`). Each type is documented at its definition site; this
 * manifest is the package's external import target for consumers that need
 * to spell out option/spec shapes.
 */
export type {
  DevInjection,
  DevOptions,
  EmitFormat,
  EmitSpec,
  GenerateOptions,
  IconSize,
  IcoSpec,
  InjectMode,
  PluginOptions,
  PngSpec,
  SharpOptions,
  SvgSpec,
};

/**
 * Vite plugin that converts an image source into one or more favicon assets.
 *
 * Returns three composable sub-plugins:
 * 1. **config** — validates options after Vite config resolves.
 * 2. **serve** — generates assets on demand and serves them via dev middleware;
 *    regenerates on HMR when the source file changes.
 * 3. **build** — generates assets at build time and emits them as Rollup assets.
 *
 * @example
 * ```ts
 * // vite.config.ts — minimal
 * import { defineConfig } from 'vite';
 * import svgToIco from 'vite-svg-to-ico';
 *
 * export default defineConfig({
 *   plugins: [svgToIco({ input: 'src/icon.svg' })],
 * });
 * // → emits favicon.ico (16/32/48). No HTML injection.
 * ```
 *
 * @example
 * ```ts
 * // Mix-and-match: combined ICO, per-size PNGs, source SVG, selective inject.
 * svgToIco({
 *   input: 'src/icon.svg',
 *   emit: [
 *     { format: 'ico', sizes: [16, 32, 48], inject: true },
 *     { format: 'png', sizes: [192, 512], inject: { sizes: [192] } },
 *     { format: 'svg', filename: 'logo.svg', inject: true },
 *   ],
 * });
 * ```
 *
 * @example
 * ```ts
 * // v2 shape (deprecated, accepted via shim, removed in v4):
 * svgToIco({
 *   input: 'src/icon.svg',
 *   emit: { source: true, sizes: 'both', inject: 'full' },
 * });
 * ```
 */
function svgToIco(opts: PluginOptions): Plugin[] {
  // The single parse boundary — validates eagerly and throws on bad config.
  const cfg = parseConfig(opts);
  const { input, inputIsUrl, inputFormat, sourceMimeType, optimize } = cfg;
  const resizeOpts = cfg.resize;
  const pngOpts = cfg.png;
  const devOpts = cfg.dev;

  const resolution = resolveSpecs(cfg.specs, { inputFormat });

  let generatedPngs: SizedPng[] | null = null;
  let cachedInputBuffer: Buffer | null = null;
  let logger: import('vite').Logger | null = null;
  let buildTransformIndexHtmlCalled = false;

  /** Resolved absolute path to the input file, set in `configResolved`. */
  let resolvedInput = input;
  /** Resolved Vite `base` path, set in `configResolved`. */
  let resolvedBase = '/';
  /** Cache-bust key appended to icon hrefs; updated on each HMR cycle. */
  let cacheId = Date.now().toString(36);

  /** Generation options shared with sharp; sizes vary per call. */
  const genOptsFor = (s: IconSize[]): GenerateOptions => ({
    sizes: s,
    optimize,
    resize: resizeOpts,
    png: pngOpts,
  });

  /** Matches `<link>` tags whose `rel` contains `icon` (covers `icon`, `shortcut icon`, `apple-touch-icon`). */
  const ICON_LINK_RE = /(<link\b[^>]*\brel\s*=\s*["'][^"']*icon[^"']*["'][^>]*\bhref\s*=\s*["'])([^"']+)(["'][^>]*>)/gi;

  /** Apply cache-bust param to a href string. `data:` URIs are returned untouched — a query param would corrupt inline bytes. */
  function cacheBust(href: string): string {
    if (href.startsWith('data:')) return href;
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}v=${cacheId}`;
  }

  /** Cache of resolved `data:` URIs, keyed by the embed injection that owns them. Cleared on HMR. */
  const embedCache = new Map<ResolvedInjection, string>();

  /** Produce (and memoize) the `data:` URI for an embed injection from the same bytes the emitter uses. */
  async function embedHref(inj: ResolvedInjection): Promise<string> {
    const cached = embedCache.get(inj);
    if (cached !== undefined) return cached;
    if (inj.href.kind !== 'embed') throw new Error('[svg-to-ico] internal: embedHref called on a non-embed injection');
    const bytes = await produce({ filename: '', mime: '', source: inj.href.source });
    const uri = toDataUri(bytes, inj.type, inj.href.encoding);
    embedCache.set(inj, uri);
    return uri;
  }

  /** Prepend `base` to a filename (handles missing/trailing slashes). */
  function withBase(base: string, filename: string): string {
    const b = base.endsWith('/') ? base : `${base}/`;
    return `${b}${filename.replace(/^\/+/, '')}`;
  }

  /**
   * Build favicon `<link>` tag descriptors from resolved injections.
   *
   * Async because `embed` injections inline the image bytes as a `data:` URI,
   * which means producing those bytes (sharp / file read). File injections
   * resolve synchronously to a `base`-prefixed, optionally cache-busted href.
   */
  async function faviconTags(options?: { base?: string; applyCacheBust?: boolean }): Promise<HtmlTagDescriptor[]> {
    const base = options?.base ?? '/';
    const bust = options?.applyCacheBust ?? false;
    const tags: HtmlTagDescriptor[] = [];
    for (const inj of resolution.injections) {
      // Embedded bytes carry no base/cache-bust — the href *is* the content.
      const href =
        inj.href.kind === 'embed'
          ? await embedHref(inj)
          : bust
            ? cacheBust(withBase(base, inj.href.filename))
            : withBase(base, inj.href.filename);
      const attrs: Record<string, string> = { rel: inj.rel, type: inj.type, href };
      if (inj.sizes) attrs['sizes'] = inj.sizes;
      tags.push({ tag: inj.tag, attrs, injectTo: 'head' as const });
    }
    return tags;
  }

  /**
   * Small client-side HMR snippet injected during dev.
   *
   * Listens for the `svg-to-ico:update` custom event and swaps every
   * `<link rel="…icon…">` href with a fresh cache-bust param so the
   * browser re-fetches the favicon without a full page reload.
   */
  const hmrClientCode = `\
if (import.meta.hot) {
  import.meta.hot.on('svg-to-ico:update', (data) => {
    document.querySelectorAll('link[rel*="icon"]').forEach((link) => {
      if (link.href.startsWith('data:')) return;
      const url = new URL(link.href);
      url.searchParams.set('v', data.cacheId);
      link.href = url.toString();
    });
  });
}`;

  /** Build the shim script that dynamically manages link tags. */
  async function buildShimScript(): Promise<string> {
    const tags = await faviconTags();
    const linksJson = JSON.stringify(tags.map((t) => t.attrs).filter(Boolean));
    const script = `\
// svg-to-ico shim: dynamically inject favicon links
const links = ${linksJson};
document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(l => l.remove());
links.forEach(attrs => {
  const link = document.createElement("link");
  Object.entries(attrs).forEach(([k, v]) => link.setAttribute(k, v));
  document.head.appendChild(link);
});`;

    if (!devOpts.hmr) return script;

    return `\
${script}
if (import.meta.hot) {
  import.meta.hot.on('svg-to-ico:update', (data) => {
    document.querySelectorAll('link[rel*="icon"]').forEach((link) => {
      if (link.href.startsWith('data:')) return;
      const url = new URL(link.href);
      url.searchParams.set('v', data.cacheId);
      link.href = url.toString();
    });
  });
}`;
  }

  /** Read + cache the source input buffer (filesystem or http(s) URL). */
  async function inputBytes(): Promise<Buffer> {
    if (!cachedInputBuffer) cachedInputBuffer = await loadInputBytes(resolvedInput);
    return cachedInputBuffer;
  }

  /** Ensure required PNGs are generated, return them. */
  async function pngs(): Promise<SizedPng[]> {
    if (!generatedPngs) {
      // URLs are fetched once and cached; sharp accepts the Buffer directly.
      // Filesystem paths can be passed through so sharp opens the file itself.
      const src = inputIsUrl ? await inputBytes() : resolvedInput;
      generatedPngs = await generateSizedPngs(src, genOptsFor(resolution.requiredSizes));
    }
    return generatedPngs;
  }

  /** Produce bytes for a resolved file. */
  async function produce(file: ResolvedFile): Promise<Buffer> {
    switch (file.source.kind) {
      case 'source-copy':
        return inputBytes();
      case 'png': {
        const all = await pngs();
        const png = all.find((p) => p.size === (file.source as { size: IconSize }).size);
        if (!png) {
          throw new Error(`[svg-to-ico] internal: missing PNG size ${(file.source as { size: IconSize }).size}`);
        }
        return png.buffer;
      }
      case 'single-ico': {
        const all = await pngs();
        const png = all.find((p) => p.size === (file.source as { size: IconSize }).size);
        if (!png) {
          throw new Error(`[svg-to-ico] internal: missing PNG size ${(file.source as { size: IconSize }).size}`);
        }
        return packIco([png]);
      }
      case 'combined-ico': {
        const all = await pngs();
        const wantSizes = (file.source as { sizes: IconSize[] }).sizes;
        const subset = wantSizes
          .map((s) => all.find((p) => p.size === s))
          .filter((p): p is SizedPng => p !== undefined);
        return packIco(subset);
      }
    }
  }

  /** Content-Type header for a file based on its mime subtype. */
  function contentType(mime: string): string {
    return mime === 'svg+xml' ? sourceMimeType : `image/${mime}`;
  }

  return [
    {
      name: 'svg-to-ico:config',
      enforce: 'post',

      configResolved(config) {
        logger = config.logger;
        // All option validation happened in `parseConfig` at factory time; this
        // hook only applies Vite's resolved `root`/`base` and surfaces warnings.
        resolvedInput = inputIsUrl ? input : resolve(config.root, input);
        resolvedBase = config.base;

        // Surface non-fatal spec issues (e.g. emit:false with no embed).
        for (const w of resolution.warnings) logger?.warn?.(`[svg-to-ico] ${w}`);
      },
    },

    ...(devOpts.enabled
      ? [
          {
            name: 'svg-to-ico:serve',
            apply: 'serve' as const,
            enforce: 'post' as const,

            configureServer(server: import('vite').ViteDevServer) {
              // Register one middleware per resolved file.
              for (const file of resolution.files) {
                const handler: Connect.NextHandleFunction = async (_req, res, next) => {
                  try {
                    const bytes = await produce(file);
                    res.setHeader('Content-Type', contentType(file.mime));
                    res.setHeader('Cache-Control', 'no-cache');
                    res.end(bytes);
                  } catch (e) {
                    next(e instanceof Error ? e : new Error(String(e)));
                  }
                };
                server.middlewares.use(`/${file.filename}`, handler);
              }
            },

            async transformIndexHtml(html: string) {
              let processed = html;
              const tags: HtmlTagDescriptor[] = [];

              if (devOpts.injection === 'shim') {
                tags.push({
                  tag: 'script',
                  attrs: { type: 'module' },
                  children: await buildShimScript(),
                  injectTo: 'head',
                });
              } else {
                if (resolution.hasAnyInjection) {
                  processed = processed.replace(INJECT_ICON_LINK_RE, '');
                  for (const tag of await faviconTags({ applyCacheBust: true })) tags.push(tag);
                } else {
                  processed = processed.replace(ICON_LINK_RE, (_match, before, href, after) => {
                    return `${before}${cacheBust(href)}${after}`;
                  });
                }

                if (devOpts.hmr) {
                  tags.push({
                    tag: 'script',
                    attrs: { type: 'module' },
                    children: hmrClientCode,
                    injectTo: 'head',
                  });
                }
              }

              return { html: processed, tags };
            },

            async buildStart() {
              const I = new Instrumentation();
              I.start('Generate ICO (serve)');
              // Pre-warm PNGs so the first request is fast.
              await pngs();
              I.end('Generate ICO (serve)');
            },

            ...(devOpts.hmr
              ? {
                  async handleHotUpdate({ file, server }: { file: string; server: import('vite').ViteDevServer }) {
                    if (file === resolvedInput) {
                      const I = new Instrumentation();
                      I.start('Regenerate ICO (HMR)');
                      generatedPngs = null;
                      cachedInputBuffer = null;
                      embedCache.clear();
                      await pngs();
                      I.end('Regenerate ICO (HMR)');

                      cacheId = Date.now().toString(36);
                      server.hot.send({
                        type: 'custom',
                        event: 'svg-to-ico:update',
                        data: { cacheId },
                      });
                    }
                  },
                }
              : {}),
          } satisfies Plugin,
        ]
      : []),

    {
      name: 'svg-to-ico:build',
      apply: 'build',
      enforce: 'post',

      async buildStart() {
        buildTransformIndexHtmlCalled = false;
        const I = new Instrumentation();
        I.start('Generate ICO (build)');

        try {
          for (const file of resolution.files) {
            const bytes = await produce(file);
            this.emitFile({ type: 'asset', fileName: file.filename, source: bytes });
          }

          I.end('Generate ICO (build)');

          if (DEBUG && logger) {
            const list = resolution.files.map((f) => f.filename).join(', ');
            logger.info(`Generated: ${list}`);
          }
        } catch (error) {
          this.error(`[svg-to-ico] Failed to generate ICO: ${error}`);
        }
      },

      /**
       * Strip existing icon `<link>` tags from the HTML and append the
       * configured favicon tag set. Records that the hook fired so
       * {@link closeBundle} can detect frameworks that bypass this pipeline.
       */
      async transformIndexHtml(html) {
        buildTransformIndexHtmlCalled = true;
        if (!resolution.hasAnyInjection) return;

        const cleaned = html.replace(INJECT_ICON_LINK_RE, '');
        return {
          html: cleaned,
          tags: await faviconTags({ base: resolvedBase }),
        };
      },

      /**
       * Surface a warning when any spec has `inject: true` but
       * `transformIndexHtml` was never called during this build cycle.
       * This happens with frameworks (SvelteKit, VitePress build, some Astro adapters)
       * that render HTML outside Vite's pipeline, causing the
       * `<link>` injection to silently no-op while files are still emitted.
       *
       * Multienvironment Vite builds (SvelteKit drives client + ssr) call
       * `closeBundle` per environment; only the client environment ever
       * triggers `transformIndexHtml`, so the warning is scoped there to
       * avoid duplicate output.
       */
      closeBundle(this: { environment?: { name?: string } }) {
        const envName = this.environment?.name;
        if (envName && envName !== 'client') return;
        if (resolution.hasAnyInjection && !buildTransformIndexHtmlCalled) {
          logger?.warn(
            `[svg-to-ico] inject was requested but transformIndexHtml was never called during build. This happens with frameworks (SvelteKit, VitePress build, some Astro adapters) that bypass Vite's HTML pipeline. Add favicon <link> tags manually to your framework's HTML template or head config, or use the bundled \`svg-to-ico inject\` CLI as a post-build step — the generated files are still emitted correctly.`,
          );
        }
      },
    },
  ] satisfies Plugin[];
}

export { svgToIco, svgToIco as default };
