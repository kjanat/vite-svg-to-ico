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

					server.hot.send({ type: 'full-reload', path: `/${output}` });
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
