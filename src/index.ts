import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { HtmlTagDescriptor, Plugin } from 'vite';

import { buildFaviconTags, INJECT_ICON_LINK_RE } from './html.ts';
import type { SizedFileInfo } from './html.ts';
import { generateSizedPngs, packIco } from './ico.ts';
import type { SizedPng } from './ico.ts';
import { DEBUG, Instrumentation } from './instrumentation.ts';
import type { EmitSizesFormat, IconSize, IncludeSourceOptions, InjectMode, PluginOptions } from './types.ts';
import { SUPPORTED_EXTENSIONS, SVG_EXTENSIONS } from './types.ts';

export type { EmitSizesFormat, IconSize, IncludeSourceOptions, InjectMode, PluginOptions };

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
 *   emitSizes: true,
 * })
 * ```
 *
 * @example
 * ```ts
 * // Auto-inject favicon link tags into HTML
 * svgToIco({
 *   input: 'src/icon.svg',
 *   includeSource: true,
 *   inject: true,
 * })
 * ```
 *
 * @example
 * ```ts
 * // Use a PNG source instead of SVG
 * svgToIco({
 *   input: 'src/icon.png',
 *   inject: 'full',
 *   emitSizes: true,
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
		optimize = true,
		includeSource: rawIncludeSource = false,
		emitSizes: rawEmitSizes = false,
		inject: rawInject = false,
	} = opts;

	const sizes = Array.isArray(rawSizes) ? rawSizes : [rawSizes];

	const sourceOpts: { enabled: boolean; name: string } = typeof rawIncludeSource === 'object'
		? { enabled: rawIncludeSource.enabled ?? true, name: rawIncludeSource.name ?? basename(input) }
		: { enabled: rawIncludeSource, name: basename(input) };

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

	return [
		{
			name: 'svg-to-ico:config',
			enforce: 'post',

			configResolved(config) {
				logger = config.logger;
				if (!input) {
					throw new Error('[svg-to-ico] `input` option is required');
				}

				if (!SUPPORTED_EXTENSIONS.has(inputExt)) {
					throw new Error(
						`[svg-to-ico] Unsupported input format: "${inputExt}". Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
					);
				}

				const invalid = sizes.filter((s) => !Number.isInteger(s) || s < 1 || s > 256);
				if (invalid.length > 0) {
					throw new Error(
						`[svg-to-ico] Invalid sizes: ${invalid.join(', ')}. Must be integers 1–256.`,
					);
				}

				const validEmitSizes: Set<string> = new Set(['png', 'ico', 'both']);
				if (typeof rawEmitSizes === 'string' && !validEmitSizes.has(rawEmitSizes)) {
					throw new Error(
						`[svg-to-ico] Invalid emitSizes value: "${rawEmitSizes}". Must be boolean, 'png', 'ico', or 'both'.`,
					);
				}

				const validInject: Set<string> = new Set(['minimal', 'full']);
				if (typeof rawInject === 'string' && !validInject.has(rawInject)) {
					throw new Error(
						`[svg-to-ico] Invalid inject value: "${rawInject}". Must be boolean, 'minimal', or 'full'.`,
					);
				}

				// Resolve input to absolute path for HMR comparison
				resolvedInput = resolve(config.root, input);
			},
		},

		{
			name: 'svg-to-ico:serve',
			apply: 'serve',
			enforce: 'post',

			configureServer(server) {
				// Main ICO endpoint
				server.middlewares.use(`/${output}`, async (_req, res, next) => {
					try {
						if (!generatedIco) {
							const pngs = await generateSizedPngs(resolvedInput, sizes, optimize);
							generatedIco = packIco(pngs);
						}
						res.setHeader('Content-Type', 'image/x-icon');
						res.setHeader('Cache-Control', 'no-cache');
						res.end(generatedIco);
					} catch (e) {
						next(e);
					}
				});

				// Source file endpoint
				if (sourceOpts.enabled) {
					server.middlewares.use(`/${sourceOpts.name}`, async (_req, res, next) => {
						try {
							const buffer = await readFile(resolvedInput);
							res.setHeader('Content-Type', sourceMimeType);
							res.end(buffer);
						} catch (e) {
							next(e);
						}
					});
				}

				// Per-size file endpoints
				if (emitSizesFormat) {
					for (const size of sizes) {
						if (emitPng) {
							server.middlewares.use(`/${outputStem}-${size}x${size}.png`, async (_req, res, next) => {
								try {
									if (!generatedPngs) {
										generatedPngs = await generateSizedPngs(resolvedInput, sizes, optimize);
									}
									const png = generatedPngs.find((p) => p.size === size);
									if (!png) {
										next();
										return;
									}
									res.setHeader('Content-Type', 'image/png');
									res.setHeader('Cache-Control', 'no-cache');
									res.end(png.buffer);
								} catch (e) {
									next(e);
								}
							});
						}
						if (emitIco) {
							server.middlewares.use(`/${outputStem}-${size}x${size}.ico`, async (_req, res, next) => {
								try {
									if (!generatedPngs) {
										generatedPngs = await generateSizedPngs(resolvedInput, sizes, optimize);
									}
									const png = generatedPngs.find((p) => p.size === size);
									if (!png) {
										next();
										return;
									}
									res.setHeader('Content-Type', 'image/x-icon');
									res.setHeader('Cache-Control', 'no-cache');
									res.end(packIco([png]));
								} catch (e) {
									next(e);
								}
							});
						}
					}
				}
			},

			transformIndexHtml(html) {
				let processed = html;
				const tags: HtmlTagDescriptor[] = [];

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

				// HMR client
				tags.push({
					tag: 'script',
					attrs: { type: 'module' },
					children: hmrClientCode,
					injectTo: 'head',
				});

				return { html: processed, tags };
			},

			async buildStart() {
				const I = new Instrumentation();
				I.start('Generate ICO (serve)');
				const pngs = await generateSizedPngs(resolvedInput, sizes, optimize);
				generatedIco = packIco(pngs);
				if (emitSizesFormat) {
					generatedPngs = pngs;
				}
				I.end('Generate ICO (serve)');
			},

			async handleHotUpdate({ file, server }) {
				if (file === resolvedInput) {
					const I = new Instrumentation();
					I.start('Regenerate ICO (HMR)');
					const pngs = await generateSizedPngs(resolvedInput, sizes, optimize);
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
		},

		{
			name: 'svg-to-ico:build',
			apply: 'build',
			enforce: 'post',

			async buildStart() {
				const I = new Instrumentation();
				I.start('Generate ICO (build)');

				try {
					const inputBuffer = await readFile(resolvedInput);
					const pngs = await generateSizedPngs(inputBuffer, sizes, optimize);
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
