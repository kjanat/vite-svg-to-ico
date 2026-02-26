/** Configuration for the [`vite-svg-to-ico`](https://github.com/kjanat/vite-svg-to-ico "GitHub") plugin.
 * @see https://npmjs.com/package/vite-svg-to-ico#options
 */
export interface PluginOptions {
	/** Absolute or root-relative path to the source image file.
	 *
	 * Supports SVG, PNG, JPEG, WebP, AVIF, GIF, and TIFF via sharp.
	 */
	input: string;
	/** Output filename for the generated `.ico` asset.
	 * @default 'favicon.ico' */
	output?: string;
	/** Pixel dimensions to rasterize (each value produces a square PNG layer).
	 *
	 * A single value is wrapped into an array automatically.
	 * Must be integers in the range 1–256 per the ICO spec.
	 * @default [16, 32, 48] */
	sizes?: IconSize | IconSize[];
	/** Apply maximum PNG compression (level 9 + adaptive filtering).
	 * @default true */
	optimize?: boolean;
	/** Copy over the input file to the output directory alongside the ICO.
	 *
	 * Pass `true` to emit with the original basename, or an object to customise.
	 * @default false */
	includeSource?: boolean | IncludeSourceOptions;
	/** Emit individual per-size files alongside the combined ICO.
	 *
	 * - `false` — only emit combined ICO (default)
	 * - `true` | `'png'` — emit PNG files for each size
	 * - `'ico'` — emit single-entry ICO files per size
	 * - `'both'` — emit both PNG and ICO per size
	 * @default false */
	emitSizes?: boolean | EmitSizesFormat;
	/** Inject `<link>` tags for generated favicons into `index.html`.
	 *
	 * - `true` | `'minimal'` — ICO + SVG source (if SVG input + `includeSource`)
	 * - `'full'` — all emitted files (ICO, SVG, per-size PNGs)
	 * - `false` — no injection
	 * @default false */
	inject?: boolean | InjectMode;
}

/** Common ICO pixel dimensions with IDE autocompletion; any integer 1–256 is accepted. */
export type IconSize = 16 | 24 | 32 | 48 | 64 | 128 | 256 | (number & {});

/** Fine-grained control for emitting the source SVG alongside the ICO. */
export interface IncludeSourceOptions {
	/** Override the output filename for the emitted source.
	 * @default basename(input) */
	name?: string;
	/** Whether to emit the source file.
	 * @default true */
	enabled?: boolean;
}

/** Format for individually-emitted per-size files. */
export type EmitSizesFormat = 'png' | 'ico' | 'both';

/** Mode for HTML `<link>` tag injection. */
export type InjectMode = 'minimal' | 'full';

/** Supported input image formats (sharp-compatible). */
export const SUPPORTED_EXTENSIONS = new Set([
	'.svg',
	'.svgz',
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.gif',
	'.avif',
	'.tiff',
	'.tif',
]);

/** Extensions that identify SVG input. */
export const SVG_EXTENSIONS = new Set(['.svg', '.svgz']);
