import { resolve } from 'node:path';
import type { Connect, HtmlTagDescriptor, Plugin } from 'vite';
import { AssetProducer } from '#assets';
import { parseConfig } from '#config';
import { buildShimScript, hmrClientCode } from '#devClient';
import { buildFaviconTags, cacheBust } from '#faviconTags';
import { INJECT_ICON_LINK_RE } from '#injectHtml';
import { DEBUG, Instrumentation } from '#instrumentation';
import type { GenerateOptions } from '#raster';
import { resolveSpecs } from '#resolveSpecs';
import type {
	DevInjection,
	DevOptions,
	EmitFormat,
	EmitSpec,
	IconSize,
	IcoSpec,
	PluginOptions,
	PngSpec,
	SharpOptions,
	SvgSpec,
} from '#types';

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
	const { input, inputIsUrl, inputFormat } = cfg;
	const devOpts = cfg.dev;

	const resolution = resolveSpecs(cfg.specs, { inputFormat });
	const producer = new AssetProducer(cfg, resolution.requiredSizes);

	let logger: import('vite').Logger | null = null;
	let buildTransformIndexHtmlCalled = false;

	/** Resolved absolute path to the input file, set in `configResolved`. */
	let resolvedInput = input;
	/** Resolved Vite `base` path, set in `configResolved`. */
	let resolvedBase = '/';
	/** Cache-bust key appended to icon hrefs; updated on each HMR cycle. */
	let cacheId = Date.now().toString(36);

	/** Matches `<link>` tags whose `rel` contains `icon` (covers `icon`, `shortcut icon`, `apple-touch-icon`). */
	const ICON_LINK_RE = /(<link\b[^>]*\brel\s*=\s*["'][^"']*icon[^"']*["'][^>]*\bhref\s*=\s*["'])([^"']+)(["'][^>]*>)/gi;

	/** Build favicon `<link>` descriptors via the shared builder; embed-kind injections produce their bytes. */
	function faviconTags(options?: { base?: string; applyCacheBust?: boolean }): Promise<HtmlTagDescriptor[]> {
		return buildFaviconTags(resolution.injections, {
			base: options?.base,
			cacheId: options?.applyCacheBust ? cacheId : undefined,
			embed: (inj) => (inj.href.kind === 'embed' ? producer.embedUri(inj) : undefined),
		});
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
				producer.setResolvedInput(resolvedInput);

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
									const bytes = await producer.produce(file);
									res.setHeader('Content-Type', producer.contentType(file.mime));
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
								children: buildShimScript(await faviconTags(), devOpts.hmr),
								injectTo: 'head',
							});
						} else {
							if (resolution.hasAnyInjection) {
								processed = processed.replace(INJECT_ICON_LINK_RE, '');
								for (const tag of await faviconTags({ applyCacheBust: true })) tags.push(tag);
							} else {
								processed = processed.replace(ICON_LINK_RE, (_match, before, href, after) => {
									return `${before}${cacheBust(href, cacheId)}${after}`;
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
						await producer.pngs();
						I.end('Generate ICO (serve)');
					},

					...(devOpts.hmr
						? {
							async handleHotUpdate({ file, server }: { file: string; server: import('vite').ViteDevServer }) {
								if (file === resolvedInput) {
									const I = new Instrumentation();
									I.start('Regenerate ICO (HMR)');
									producer.reset();
									await producer.pngs();
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
						const bytes = await producer.produce(file);
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
