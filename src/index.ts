import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Plugin } from 'vite';

import { generateIco } from './ico.ts';
import { DEBUG, Instrumentation } from './instrumentation.ts';
import type { IconSize, IncludeSourceOptions, PluginOptions } from './types.ts';

export type { IconSize, IncludeSourceOptions, PluginOptions };

/**
 * Vite plugin that converts an SVG source into a multi-size `.ico` favicon.
 *
 * Returns three composable sub-plugins:
 * 1. **config** — validates options after config is resolved.
 * 2. **serve** — lazily generates the ICO and serves it via dev-server middleware;
 *    regenerates on HMR when the source SVG changes.
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
 * // Skip PNG optimization for faster builds
 * svgToIco({
 *   input: 'src/icon.svg',
 *   optimize: false,
 * })
 * ```
 *
 * @example
 * ```ts
 * // Emit the source SVG alongside the ICO
 * svgToIco({
 *   input: 'src/icon.svg',
 *   includeSource: true,
 * })
 * ```
 *
 * @example
 * ```ts
 * // Emit the source SVG with a custom filename
 * svgToIco({
 *   input: 'src/icon.svg',
 *   includeSource: { name: 'logo.svg' },
 * })
 * ```
 */
export default function svgToIco(opts: PluginOptions): Plugin[] {
	let generatedIco: Buffer | null = null;
	let logger: { info: (msg: string) => void } | null = null;

	const {
		input,
		output = 'favicon.ico',
		sizes: rawSizes = [16, 32, 48],
		optimize = true,
		includeSource: rawIncludeSource = false,
	} = opts;

	const sizes = Array.isArray(rawSizes) ? rawSizes : [rawSizes];

	const sourceOpts: { enabled: boolean; name: string } = typeof rawIncludeSource === 'object'
		? { enabled: rawIncludeSource.enabled ?? true, name: rawIncludeSource.name ?? basename(input) }
		: { enabled: rawIncludeSource, name: basename(input) };

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
	const hmrClient = `
<script type="module">
if (import.meta.hot) {
	import.meta.hot.on('svg-to-ico:update', (data) => {
		document.querySelectorAll('link[rel*="icon"]').forEach((link) => {
			const url = new URL(link.href);
			url.searchParams.set('v', data.cacheId);
			link.href = url.toString();
		});
	});
}
</script>`;

	return [
		{
			name: 'svg-to-ico:config',
			enforce: 'post',

			configResolved(config) {
				logger = config.logger;
				if (!input) {
					throw new Error('[svg-to-ico] `input` option is required');
				}
				const invalid = sizes.filter((s) => !Number.isInteger(s) || s < 1 || s > 256);
				if (invalid.length > 0) {
					throw new Error(
						`[svg-to-ico] Invalid sizes: ${invalid.join(', ')}. Must be integers 1–256.`,
					);
				}
			},
		},

		{
			name: 'svg-to-ico:serve',
			apply: 'serve',
			enforce: 'post',

			configureServer(server) {
				server.middlewares.use(`/${output}`, async (_req, res, next) => {
					try {
						if (!generatedIco) {
							generatedIco = await generateIco(input, sizes, optimize);
						}
						res.setHeader('Content-Type', 'image/x-icon');
						res.setHeader('Cache-Control', 'no-cache');
						res.end(generatedIco);
					} catch (e) {
						next(e);
					}
				});

				if (sourceOpts.enabled) {
					server.middlewares.use(`/${sourceOpts.name}`, async (_req, res, next) => {
						try {
							const svgBuffer = await readFile(input);
							res.setHeader('Content-Type', 'image/svg+xml');
							res.end(svgBuffer);
						} catch (e) {
							next(e);
						}
					});
				}
			},

			transformIndexHtml(html) {
				const tagged = html.replace(ICON_LINK_RE, (_match, before, href, after) => {
					const sep = href.includes('?') ? '&' : '?';
					return `${before}${href}${sep}v=${cacheId}${after}`;
				});
				return tagged.replace('</head>', `${hmrClient}\n</head>`);
			},

			async buildStart() {
				const I = new Instrumentation();
				I.start('Generate ICO (serve)');
				generatedIco = await generateIco(input, sizes, optimize);
				I.end('Generate ICO (serve)');
			},

			async handleHotUpdate({ file, server }) {
				if (file === input) {
					const I = new Instrumentation();
					I.start('Regenerate ICO (HMR)');
					generatedIco = await generateIco(input, sizes, optimize);
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
					const svgBuffer = await readFile(input);
					const icoBuffer = await generateIco(svgBuffer, sizes, optimize);

					this.emitFile({
						type: 'asset',
						fileName: output,
						source: icoBuffer,
					});

					if (sourceOpts.enabled) {
						this.emitFile({
							type: 'asset',
							fileName: sourceOpts.name,
							source: svgBuffer,
						});
					}

					I.end('Generate ICO (build)');

					if (DEBUG && logger) {
						logger.info(`Generated ${output}`);
					}
				} catch (error) {
					this.error(`[svg-to-ico] Failed to generate ICO: ${error}`);
				}
			},
		},
	] satisfies Plugin[];
}
