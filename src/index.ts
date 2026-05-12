import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import type { HtmlTagDescriptor, Plugin } from 'vite';

import { INJECT_ICON_LINK_RE } from './html.ts';
import type { GenerateOptions, SizedPng } from './ico.ts';
import { generateSizedPngs, packIco } from './ico.ts';
import { DEBUG, Instrumentation } from './instrumentation.ts';
import { normalizeEmit } from './normalize-emit.ts';
import { type ResolvedFile, resolveSpecs } from './resolve-specs.ts';
import type {
	DevInjection,
	DevOptions,
	EmitFormat,
	EmitSizesFormat,
	EmitSpec,
	IconSize,
	IcoSpec,
	IncludeSourceOptions,
	InjectMode,
	NormalizedEmit,
	PluginOptions,
	PngSpec,
	SharpOptions,
	SvgSpec,
} from './types.ts';
import type { EmitOptions, LegacyEmitOptions } from './types.ts'; // Re-exported for v2 compatibility.
import {
	DEV_INJECTIONS,
	EMIT_FORMATS,
	EMIT_SIZES_FORMATS,
	INJECT_MODES,
	SUPPORTED_EXTENSIONS,
	SVG_EXTENSIONS,
} from './types.ts';
import { isLegacyEmit } from './types.ts';

export type {
	DevInjection,
	DevOptions,
	EmitFormat,
	EmitOptions,
	EmitSizesFormat,
	EmitSpec,
	GenerateOptions,
	IconSize,
	IcoSpec,
	IncludeSourceOptions,
	InjectMode,
	LegacyEmitOptions,
	NormalizedEmit,
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
export default function svgToIco(opts: PluginOptions): Plugin[] {
	let generatedPngs: SizedPng[] | null = null;
	let cachedInputBuffer: Buffer | null = null;
	let logger: import('vite').Logger | null = null;
	let buildTransformIndexHtmlCalled = false;
	let legacyWarned = false;

	const { input, sizes: rawSizes = [16, 32, 48], sharp: sharpOpts, dev: rawDev = true } = opts;

	const optimize = sharpOpts?.optimize ?? true;
	const resizeOpts = sharpOpts?.resize;
	const pngOpts = sharpOpts?.png;
	const sizes = Array.isArray(rawSizes) ? rawSizes : [rawSizes];

	// --- dev normalization ---
	const devDefaults = { enabled: true, injection: 'transform' as DevInjection, hmr: true };
	const devOpts: Required<DevOptions> = typeof rawDev === 'boolean'
		? { ...devDefaults, enabled: rawDev }
		: { ...devDefaults, ...rawDev };

	// --- input format detection ---
	const inputExt = extname(input).toLowerCase();
	const inputFormat = SVG_EXTENSIONS.has(inputExt) ? 'svg' : inputExt.replace('.', '');

	/** Normalize extensions to correct MIME sub-types. */
	const MIME_OVERRIDES: Record<string, string> = { jpg: 'jpeg', tif: 'tiff' };
	const mimeFormat = MIME_OVERRIDES[inputFormat] ?? inputFormat;
	const sourceMimeType = inputFormat === 'svg' ? 'image/svg+xml' : `image/${mimeFormat}`;

	// --- emit normalization → spec array ---
	const { specs, wasLegacy } = normalizeEmit(opts, sizes);
	const resolution = resolveSpecs(specs, { inputFormat });

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

	/** Apply cache-bust param to an href string. */
	function cacheBust(href: string): string {
		const sep = href.includes('?') ? '&' : '?';
		return `${href}${sep}v=${cacheId}`;
	}

	/** Prepend `base` to a filename (handles missing/trailing slashes). */
	function withBase(base: string, filename: string): string {
		const b = base.endsWith('/') ? base : `${base}/`;
		return `${b}${filename.replace(/^\/+/, '')}`;
	}

	/** Build favicon `<link>` tag descriptors from resolved injections. */
	function faviconTags(options?: { base?: string; applyCacheBust?: boolean }): HtmlTagDescriptor[] {
		const base = options?.base ?? '/';
		const bust = options?.applyCacheBust ?? false;
		return resolution.injections.map((inj) => {
			const href = bust ? cacheBust(withBase(base, inj.filename)) : withBase(base, inj.filename);
			const attrs: Record<string, string> = { rel: inj.rel, type: inj.type, href };
			if (inj.sizes) attrs['sizes'] = inj.sizes;
			return { tag: inj.tag, attrs, injectTo: 'head' as const };
		});
	}

	/**
	 * Small client-side HMR snippet injected during dev.
	 *
	 * Listens for the `svg-to-ico:update` custom event and swaps every
	 * `<link rel="…icon…">` href with a fresh cache-bust param so the
	 * browser re-fetches the favicon without a full page reload.
	 */
	const hmrClientCode = [
		'if (import.meta.hot) {',
		"	import.meta.hot.on('svg-to-ico:update', (data) => {",
		'		document.querySelectorAll(\'link[rel*="icon"]\').forEach((link) => {',
		'			const url = new URL(link.href);',
		"			url.searchParams.set('v', data.cacheId);",
		'			link.href = url.toString();',
		'		});',
		'	});',
		'}',
	].join('\n');

	/** Build the shim script that dynamically manages link tags. */
	function buildShimScript(): string {
		const tags = faviconTags();
		const linksJson = JSON.stringify(tags.map((t) => t.attrs).filter(Boolean));
		const lines = [
			'// svg-to-ico shim: dynamically inject favicon links',
			`const links = ${linksJson};`,
			'document.querySelectorAll(\'link[rel="icon"], link[rel="shortcut icon"]\').forEach(l => l.remove());',
			'links.forEach(attrs => {',
			'  const link = document.createElement("link");',
			'  Object.entries(attrs).forEach(([k, v]) => link.setAttribute(k, v));',
			'  document.head.appendChild(link);',
			'});',
		];
		if (devOpts.hmr) {
			lines.push(
				'if (import.meta.hot) {',
				"  import.meta.hot.on('svg-to-ico:update', (data) => {",
				'    document.querySelectorAll(\'link[rel*="icon"]\').forEach((link) => {',
				'      const url = new URL(link.href);',
				"      url.searchParams.set('v', data.cacheId);",
				'      link.href = url.toString();',
				'    });',
				'  });',
				'}',
			);
		}
		return lines.join('\n');
	}

	/** Read + cache the source input buffer. */
	async function inputBytes(): Promise<Buffer> {
		if (!cachedInputBuffer) cachedInputBuffer = await readFile(resolvedInput);
		return cachedInputBuffer;
	}

	/** Ensure required PNGs are generated, return them. */
	async function pngs(): Promise<SizedPng[]> {
		if (!generatedPngs) {
			generatedPngs = await generateSizedPngs(resolvedInput, genOptsFor(resolution.requiredSizes));
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

	/** Content-Type header for a file based on its mime sub-type. */
	function contentType(mime: string): string {
		return mime === 'svg+xml' ? sourceMimeType : `image/${mime}`;
	}

	/** Log the v2 deprecation warning at most once per plugin instance. */
	function warnIfLegacy(): void {
		if (!wasLegacy || legacyWarned) return;
		legacyWarned = true;
		logger?.warn?.(
			`[svg-to-ico] The \`emit: { source, sizes, inject }\` object shape is deprecated and will be removed in v4. `
				+ `Migrate to the v3 array form: \`emit: [{ format: 'ico', ... }, { format: 'png', ... }]\`. `
				+ `See https://github.com/kjanat/vite-svg-to-ico/blob/master/CHANGELOG.md for the migration guide.`,
		);
	}

	return [
		{
			name: 'svg-to-ico:config',
			enforce: 'post',

			configResolved(config) {
				logger = config.logger;
				warnIfLegacy();

				if (!input) {
					throw new Error('[svg-to-ico] `input` must be a non-empty string');
				}
				if (!SUPPORTED_EXTENSIONS.has(inputExt)) {
					throw new Error(
						`[svg-to-ico] Unsupported input format: "${inputExt}". Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
					);
				}
				if (sizes.length === 0) {
					throw new Error('[svg-to-ico] `sizes` must contain at least one value');
				}

				// Validate top-level sizes 1–256.
				const invalidTop = sizes.filter((s) => !Number.isInteger(s) || s < 1 || s > 256);
				if (invalidTop.length > 0) {
					throw new Error(`[svg-to-ico] Invalid sizes: ${invalidTop.join(', ')}. Must be integers 1–256.`);
				}

				// Validate every spec.
				for (const [i, spec] of specs.entries()) {
					if (!(EMIT_FORMATS as readonly string[]).includes(spec.format)) {
						throw new Error(
							`[svg-to-ico] emit[${i}].format invalid: "${spec.format}". Must be one of ${
								EMIT_FORMATS.map((f) => `'${f}'`).join(', ')
							}.`,
						);
					}
					if (spec.format === 'ico' && spec.sizes) {
						if (spec.sizes.length === 0) {
							throw new Error(`[svg-to-ico] emit[${i}] (ico) requires \`sizes\` with at least one value.`);
						}
						const bad = spec.sizes.filter((s) => !Number.isInteger(s) || s < 1 || s > 256);
						if (bad.length > 0) {
							throw new Error(`[svg-to-ico] emit[${i}].sizes invalid: ${bad.join(', ')}. Must be integers 1–256.`);
						}
					}
					if (spec.format === 'png') {
						if (!spec.sizes || spec.sizes.length === 0) {
							throw new Error(`[svg-to-ico] emit[${i}] (png) requires \`sizes\` with at least one value.`);
						}
						const bad = spec.sizes.filter((s) => !Number.isInteger(s) || s < 1 || s > 256);
						if (bad.length > 0) {
							throw new Error(`[svg-to-ico] emit[${i}].sizes invalid: ${bad.join(', ')}. Must be integers 1–256.`);
						}
						if (typeof spec.inject === 'object' && spec.inject !== null && spec.inject.sizes) {
							const allowed = new Set(spec.sizes);
							const bad = spec.inject.sizes.filter((s) => !allowed.has(s));
							if (bad.length > 0) {
								throw new Error(
									`[svg-to-ico] emit[${i}].inject.sizes contains values not in spec.sizes: ${bad.join(', ')}. `
										+ `Must be a subset of [${spec.sizes.join(', ')}].`,
								);
							}
						}
					}
				}

				// Legacy shape: keep v2-era string validation for nicer error messages.
				if (wasLegacy && isLegacyEmit(opts.emit)) {
					const legacy = opts.emit;
					if (typeof legacy.sizes === 'string' && !(EMIT_SIZES_FORMATS as readonly string[]).includes(legacy.sizes)) {
						throw new Error(
							`[svg-to-ico] Invalid emitSizes value: "${legacy.sizes}". Must be boolean, ${
								EMIT_SIZES_FORMATS.map((f) => `'${f}'`).join(', ')
							}.`,
						);
					}
					if (typeof legacy.inject === 'string' && !(INJECT_MODES as readonly string[]).includes(legacy.inject)) {
						throw new Error(
							`[svg-to-ico] Invalid inject value: "${legacy.inject}". Must be boolean, ${
								INJECT_MODES.map((m) => `'${m}'`).join(', ')
							}.`,
						);
					}
				}

				if (
					typeof rawDev === 'object' && rawDev.injection !== undefined
					&& !(DEV_INJECTIONS as readonly string[]).includes(rawDev.injection)
				) {
					throw new Error(
						`[svg-to-ico] Invalid dev.injection value: "${rawDev.injection}". Must be ${
							DEV_INJECTIONS.map((m) => `'${m}'`).join(', ')
						}.`,
					);
				}

				resolvedInput = resolve(config.root, input);
				resolvedBase = config.base;
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
							server.middlewares.use(
								`/${file.filename}`,
								async (_req: any, res: any, next: any) => {
									try {
										const bytes = await produce(file);
										res.setHeader('Content-Type', contentType(file.mime));
										res.setHeader('Cache-Control', 'no-cache');
										res.end(bytes);
									} catch (e: any) {
										next(e);
									}
								},
							);
						}
					},

					transformIndexHtml(html: string) {
						let processed = html;
						const tags: HtmlTagDescriptor[] = [];

						if (devOpts.injection === 'shim') {
							tags.push({
								tag: 'script',
								attrs: { type: 'module' },
								children: buildShimScript(),
								injectTo: 'head',
							});
						} else {
							if (resolution.hasAnyInjection) {
								processed = processed.replace(INJECT_ICON_LINK_RE, '');
								for (const tag of faviconTags({ applyCacheBust: true })) tags.push(tag);
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
			transformIndexHtml(html) {
				buildTransformIndexHtmlCalled = true;
				if (!resolution.hasAnyInjection) return;

				const cleaned = html.replace(INJECT_ICON_LINK_RE, '');
				return {
					html: cleaned,
					tags: faviconTags({ base: resolvedBase }),
				};
			},

			/**
			 * Surface a warning when any spec has `inject: true` but
			 * `transformIndexHtml` was never called during this build cycle. This
			 * happens with frameworks (SvelteKit, VitePress build, some Astro
			 * adapters) that render HTML outside Vite's pipeline, causing the
			 * `<link>` injection to silently no-op while files are still emitted.
			 *
			 * Multi-environment Vite builds (SvelteKit drives client + ssr) call
			 * `closeBundle` per environment; only the client environment ever
			 * triggers `transformIndexHtml`, so the warning is scoped there to
			 * avoid duplicate output.
			 */
			closeBundle(this: { environment?: { name?: string } }) {
				const envName = this.environment?.name;
				if (envName && envName !== 'client') return;
				if (resolution.hasAnyInjection && !buildTransformIndexHtmlCalled) {
					logger?.warn(
						`[svg-to-ico] inject was requested but transformIndexHtml was never called during build. `
							+ `This happens with frameworks (SvelteKit, VitePress build, some Astro adapters) that bypass Vite's HTML pipeline. `
							+ `Add favicon <link> tags manually to your framework's HTML template or head config, `
							+ `or use the bundled \`svg-to-ico inject\` CLI as a postbuild step — the generated files are still emitted correctly.`,
					);
				}
			},
		},
	] satisfies Plugin[];
}
