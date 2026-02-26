import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { HtmlTagDescriptor, Plugin } from 'vite';

import { buildFaviconTags, INJECT_ICON_LINK_RE } from './html.ts';
import type { SizedFileInfo } from './html.ts';
import { generateSizedPngs, packIco } from './ico.ts';
import type { GenerateOptions, SizedPng } from './ico.ts';
import { DEBUG, Instrumentation } from './instrumentation.ts';
import type { DevInjection, DevOptions, EmitOptions, EmitSizesFormat, IconSize, IncludeSourceOptions, InjectMode, PluginOptions, SharpOptions } from './types.ts';
import { DEV_INJECTIONS, EMIT_SIZES_FORMATS, INJECT_MODES, SUPPORTED_EXTENSIONS, SVG_EXTENSIONS } from './types.ts';

export type { DevInjection, DevOptions, EmitOptions, EmitSizesFormat, GenerateOptions, IconSize, IncludeSourceOptions, InjectMode, PluginOptions, SharpOptions };

/**
 * Vite plugin that converts an image source into a multi-size `.ico` favicon.
 *
 * Returns three composable sub-plugins:
 * 1. **config** — validates options after config is resolved.
 * 2. **serve** — lazily generates the ICO and serves it via dev-server middleware;
 *    regenerates on HMR when the source file changes.
 * 3. **build** — generates the ICO at build time and emits it as a Rollup asset.
 *
 * @example
 * ```ts
 * // Basic usage
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import svgToIco from 'vite-svg-to-ico';
 *
 * export default defineConfig({
 *   plugins: [
 *     svgToIco({ input: 'src/icon.svg' }),
 *   ],
 * });
 * ```
 *
 * @example
 * ```ts
 * // Custom sizes and output filename
 * svgToIco({
 *   input: 'src/logo.svg',
 *   output: 'icon.ico',
 *   sizes: [16, 24, 32, 48, 64, 128, 256],
 * })
 * ```
 *
 * @example
 * ```ts
 * // Emit individual per-size PNGs alongside the ICO
 * svgToIco({
 *   input: 'src/icon.svg',
 *   emit: { sizes: true },
 * })
 * ```
 *
 * @example
 * ```ts
 * // Auto-inject favicon link tags into HTML
 * svgToIco({
 *   input: 'src/icon.svg',
 *   emit: { source: true, inject: true },
 * })
 * ```
 *
 * @example
 * ```ts
 * // Use a PNG source instead of SVG
 * svgToIco({
 *   input: 'src/icon.png',
 *   emit: { inject: 'full', sizes: true },
 * })
 * ```
 *
 * @example
 * ```ts
 * // Override sharp resize/PNG options
 * svgToIco({
 *   input: 'src/pixel-icon.svg',
 *   sharp: {
 *     resize: { kernel: 'nearest' },  // crisp pixel art
 *     png: { palette: true, colours: 64 },
 *   },
 * })
 * ```
 */
export default function svgToIco(opts: PluginOptions): Plugin[] {
	let generatedIco: Buffer | null = null;
	let generatedPngs: SizedPng[] | null = null;
	let logger: { info: (msg: string) => void } | null = null;

	const {
		input,
		output = 'favicon.ico',
		sizes: rawSizes = [16, 32, 48],
		emit: emitOpts,
		sharp: sharpOpts,
		dev: rawDev = true,
	} = opts;

	const optimize = sharpOpts?.optimize ?? true;
	const rawIncludeSource = emitOpts?.source ?? false;
	const rawEmitSizes = emitOpts?.sizes ?? false;
	const rawInject = emitOpts?.inject ?? false;
	const resizeOpts = sharpOpts?.resize;
	const pngOpts = sharpOpts?.png;

	const sizes = Array.isArray(rawSizes) ? rawSizes : [rawSizes];

	// --- dev normalization ---
	const devDefaults = { enabled: true, injection: 'transform' as DevInjection, hmr: true };
	const devOpts: Required<DevOptions> = typeof rawDev === 'boolean'
		? { ...devDefaults, enabled: rawDev }
		: { ...devDefaults, ...rawDev };

	const sourceOpts: { enabled: boolean; name: string } = typeof rawIncludeSource === 'object'
		? { enabled: rawIncludeSource.enabled ?? true, name: rawIncludeSource.name ?? basename(input) }
		: { enabled: !!rawIncludeSource, name: basename(input) };

	/** Shared generation options threaded to every `generateSizedPngs` call. */
	const genOpts: GenerateOptions = { sizes, optimize, resize: resizeOpts, png: pngOpts };

	// --- Input format detection ---
	const inputExt = extname(input).toLowerCase();
	const inputFormat = SVG_EXTENSIONS.has(inputExt) ? 'svg' : inputExt.replace('.', '');

	/** Normalize extensions to correct MIME sub-types. */
	const MIME_OVERRIDES: Record<string, string> = { jpg: 'jpeg', tif: 'tiff' };
	const mimeFormat = MIME_OVERRIDES[inputFormat] ?? inputFormat;
	const sourceMimeType = inputFormat === 'svg' ? 'image/svg+xml' : `image/${mimeFormat}`;

	/** Resolved absolute path to the input file, set in `configResolved`. */
	let resolvedInput = input;

	// --- emitSizes normalization ---
	const emitSizesFormat: EmitSizesFormat | false = rawEmitSizes === true
		? 'png'
		: rawEmitSizes === false
		? false
		: rawEmitSizes;

	const emitPng = emitSizesFormat === 'png' || emitSizesFormat === 'both';
	const emitIco = emitSizesFormat === 'ico' || emitSizesFormat === 'both';

	// --- inject normalization ---
	const injectMode: InjectMode | false = rawInject === true
		? 'minimal'
		: rawInject === false
		? false
		: rawInject;

	// --- Output stem for per-size filenames ---
	const outputStem = output.replace(/\.ico$/i, '');

	/** Build the list of per-size files that will be emitted. */
	function buildSizedFileInfos(): SizedFileInfo[] {
		if (!emitSizesFormat) return [];
		const files: SizedFileInfo[] = [];
		for (const size of sizes) {
			if (emitPng) {
				files.push({ name: `${outputStem}-${size}x${size}.png`, size, format: 'png' });
			}
			if (emitIco) {
				files.push({ name: `${outputStem}-${size}x${size}.ico`, size, format: 'x-icon' });
			}
		}
		return files;
	}

	/** Cache-bust key appended to icon hrefs; updated on each HMR cycle. */
	let cacheId = Date.now().toString(36);

	/** Matches `<link>` tags whose `rel` contains `icon` (covers `icon`, `shortcut icon`, `apple-touch-icon`). */
	const ICON_LINK_RE = /(<link\b[^>]*\brel\s*=\s*["'][^"']*icon[^"']*["'][^>]*\bhref\s*=\s*["'])([^"']+)(["'][^>]*>)/gi;

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

	/** Build favicon tags for HTML injection. */
	function faviconTags(): HtmlTagDescriptor[] {
		if (!injectMode) return [];
		return buildFaviconTags({
			output,
			sizes,
			sourceEmitted: sourceOpts.enabled,
			sourceName: sourceOpts.name,
			inputFormat,
			mode: injectMode,
			sizedFiles: buildSizedFileInfos(),
		});
	}

	/** Apply cache-bust param to an href string. */
	function cacheBust(href: string): string {
		const sep = href.includes('?') ? '&' : '?';
		return `${href}${sep}v=${cacheId}`;
	}

	/** Build the shim script that dynamically manages link tags. */
	function buildShimScript(): string {
		const tags = faviconTags();
		const linksJson = JSON.stringify(
			tags.map((t) => t.attrs).filter(Boolean),
		);
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

	return [
		{
			name: 'svg-to-ico:config',
			enforce: 'post',

			configResolved(config) {
				logger = config.logger;
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

				const invalid = sizes.filter((s) => !Number.isInteger(s) || s < 1 || s > 256);
				if (invalid.length > 0) {
					throw new Error(
						`[svg-to-ico] Invalid sizes: ${invalid.join(', ')}. Must be integers 1–256.`,
					);
				}

				if (typeof rawEmitSizes === 'string' && !(EMIT_SIZES_FORMATS as readonly string[]).includes(rawEmitSizes)) {
					throw new Error(
						`[svg-to-ico] Invalid emitSizes value: "${rawEmitSizes}". Must be boolean, ${
							EMIT_SIZES_FORMATS.map((f) => `'${f}'`).join(', ')
						}.`,
					);
				}

				if (typeof rawInject === 'string' && !(INJECT_MODES as readonly string[]).includes(rawInject)) {
					throw new Error(
						`[svg-to-ico] Invalid inject value: "${rawInject}". Must be boolean, ${
							INJECT_MODES.map((m) => `'${m}'`).join(', ')
						}.`,
					);
				}

				if (typeof rawDev === 'object' && rawDev.injection !== undefined
					&& !(DEV_INJECTIONS as readonly string[]).includes(rawDev.injection)) {
					throw new Error(
						`[svg-to-ico] Invalid dev.injection value: "${rawDev.injection}". Must be ${
							DEV_INJECTIONS.map((m) => `'${m}'`).join(', ')
						}.`,
					);
				}

				// Resolve input to absolute path for HMR comparison
				resolvedInput = resolve(config.root, input);
			},
		},

		...(devOpts.enabled ? [{
			name: 'svg-to-ico:serve',
			apply: 'serve' as const,
			enforce: 'post' as const,

			configureServer(server: import('vite').ViteDevServer) {
				// Main ICO endpoint
				server.middlewares.use(`/${output}`, async (_req: any, res: any, next: any) => {
					try {
						if (!generatedIco) {
							const pngs = await generateSizedPngs(resolvedInput, genOpts);
							generatedIco = packIco(pngs);
							if (emitSizesFormat) generatedPngs = pngs;
						}
						res.setHeader('Content-Type', 'image/x-icon');
						res.setHeader('Cache-Control', 'no-cache');
						res.end(generatedIco);
					} catch (e: any) {
						next(e);
					}
				});

				// Source file endpoint
				if (sourceOpts.enabled) {
					server.middlewares.use(`/${sourceOpts.name}`, async (_req: any, res: any, next: any) => {
						try {
							const buffer = await readFile(resolvedInput);
							res.setHeader('Content-Type', sourceMimeType);
							res.end(buffer);
						} catch (e: any) {
							next(e);
						}
					});
				}

				// Per-size file endpoints
				if (emitSizesFormat) {
					for (const size of sizes) {
						if (emitPng) {
							server.middlewares.use(`/${outputStem}-${size}x${size}.png`, async (_req: any, res: any, next: any) => {
								try {
									if (!generatedPngs) {
										generatedPngs = await generateSizedPngs(resolvedInput, genOpts);
									}
									const png = generatedPngs.find((p) => p.size === size);
									if (!png) {
										next();
										return;
									}
									res.setHeader('Content-Type', 'image/png');
									res.setHeader('Cache-Control', 'no-cache');
									res.end(png.buffer);
								} catch (e: any) {
									next(e);
								}
							});
						}
						if (emitIco) {
							server.middlewares.use(`/${outputStem}-${size}x${size}.ico`, async (_req: any, res: any, next: any) => {
								try {
									if (!generatedPngs) {
										generatedPngs = await generateSizedPngs(resolvedInput, genOpts);
									}
									const png = generatedPngs.find((p) => p.size === size);
									if (!png) {
										next();
										return;
									}
									res.setHeader('Content-Type', 'image/x-icon');
									res.setHeader('Cache-Control', 'no-cache');
									res.end(packIco([png]));
								} catch (e: any) {
									next(e);
								}
							});
						}
					}
				}
			},

			transformIndexHtml(html: string) {
				let processed = html;
				const tags: HtmlTagDescriptor[] = [];

				if (devOpts.injection === 'shim') {
					// Shim mode: inject a script that dynamically manages link tags
					tags.push({
						tag: 'script',
						attrs: { type: 'module' },
						children: buildShimScript(),
						injectTo: 'head',
					});
				} else {
					// Transform mode (default): rewrite HTML directly
					if (injectMode) {
						// Strip existing icon-only links (preserves apple-touch-icon)
						processed = processed.replace(INJECT_ICON_LINK_RE, '');
						// Build and cache-bust injected tags
						for (const tag of faviconTags()) {
							if (tag.attrs && typeof tag.attrs['href'] === 'string') {
								tag.attrs['href'] = cacheBust(tag.attrs['href']);
							}
							tags.push(tag);
						}
					} else {
						// Cache-bust existing icon links
						processed = processed.replace(ICON_LINK_RE, (_match, before, href, after) => {
							return `${before}${cacheBust(href)}${after}`;
						});
					}

					// HMR client (only in transform mode; shim handles its own HMR)
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
				const pngs = await generateSizedPngs(resolvedInput, genOpts);
				generatedIco = packIco(pngs);
				if (emitSizesFormat) {
					generatedPngs = pngs;
				}
				I.end('Generate ICO (serve)');
			},

			...(devOpts.hmr ? {
				async handleHotUpdate({ file, server }: { file: string; server: import('vite').ViteDevServer }) {
					if (file === resolvedInput) {
						const I = new Instrumentation();
						I.start('Regenerate ICO (HMR)');
						const pngs = await generateSizedPngs(resolvedInput, genOpts);
						generatedIco = packIco(pngs);
						if (emitSizesFormat) {
							generatedPngs = pngs;
						}
						I.end('Regenerate ICO (HMR)');

						cacheId = Date.now().toString(36);
						server.hot.send({
							type: 'custom',
							event: 'svg-to-ico:update',
							data: { cacheId },
						});
					}
				},
			} : {}),
		} satisfies Plugin] : []),

		{
			name: 'svg-to-ico:build',
			apply: 'build',
			enforce: 'post',

			async buildStart() {
				const I = new Instrumentation();
				I.start('Generate ICO (build)');

				try {
					const inputBuffer = await readFile(resolvedInput);
					const pngs = await generateSizedPngs(inputBuffer, genOpts);
					const icoBuffer = packIco(pngs);

					this.emitFile({
						type: 'asset',
						fileName: output,
						source: icoBuffer,
					});

					if (sourceOpts.enabled) {
						this.emitFile({
							type: 'asset',
							fileName: sourceOpts.name,
							source: inputBuffer,
						});
					}

					// Per-size files
					if (emitSizesFormat) {
						for (const png of pngs) {
							if (emitPng) {
								this.emitFile({
									type: 'asset',
									fileName: `${outputStem}-${png.size}x${png.size}.png`,
									source: png.buffer,
								});
							}
							if (emitIco) {
								this.emitFile({
									type: 'asset',
									fileName: `${outputStem}-${png.size}x${png.size}.ico`,
									source: packIco([png]),
								});
							}
						}
					}

					I.end('Generate ICO (build)');

					if (DEBUG && logger) {
						logger.info(`Generated ${output}`);
					}
				} catch (error) {
					this.error(`[svg-to-ico] Failed to generate ICO: ${error}`);
				}
			},

			transformIndexHtml(html) {
				if (!injectMode) return;

				const cleaned = html.replace(INJECT_ICON_LINK_RE, '');
				return {
					html: cleaned,
					tags: faviconTags(),
				};
			},
		},
	] satisfies Plugin[];
}
