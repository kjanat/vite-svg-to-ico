import type { PngOptions, ResizeOptions } from 'sharp';

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
	 * @default 'favicon.ico'
	 */
	output?: string;
	/** Pixel dimensions to rasterize (each value produces a square PNG layer).
	 *
	 * A single value is wrapped into an array automatically.
	 * Must be integers in the range 1–256 per the ICO spec.
	 * @default [16, 32, 48]
	 */
	sizes?: IconSize | IconSize[];
	/** Apply maximum PNG compression (level 9 + adaptive filtering).
	 * @default true */
	optimize?: boolean;
	/** Copy over the input file to the output directory alongside the ICO.
	 *
	 * Pass `true` to emit with the original basename, or an object to customise.
	 * @default false
	 */
	includeSource?: boolean | IncludeSourceOptions;
	/** Emit individual per-size files alongside the combined ICO.
	 *
	 * - `false` — only emit combined ICO (default)
	 * - `true` | `'png'` — emit PNG files for each size
	 * - `'ico'` — emit single-entry ICO files per size
	 * - `'both'` — emit both PNG and ICO per size
	 * @default false
	 */
	emitSizes?: boolean | EmitSizesFormat;
	/** Inject `<link>` tags for generated favicons into `index.html`.
	 *
	 * - `true` | `'minimal'` — ICO + SVG source (if SVG input + `includeSource`)
	 * - `'full'` — all emitted files (ICO, SVG, per-size PNGs)
	 * - `false` — no injection
	 * @default false
	 */
	inject?: boolean | InjectMode;
	/** Sharp resize options forwarded to `sharp().resize()`.
	 *
	 * `width` and `height` are always set by the per-size value and cannot be overridden.
	 * Values are merged over the defaults, so you only need to specify what you want to change.
	 *
	 * @default { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }
	 * @example { kernel: 'nearest' }  // pixel art
	 * @example { background: '#fff' } // opaque background for JPEG sources
	 * @example { fit: 'cover' }       // crop instead of letterbox
	 */
	resize?: Omit<ResizeOptions, 'width' | 'height'>;
	/** Sharp PNG output options forwarded to `sharp().png()`.
	 *
	 * When set, values are merged over the defaults derived from {@link optimize}.
	 * Explicit values here take precedence over the `optimize` shorthand.
	 *
	 * @example { palette: true, colours: 64 } // indexed color PNG
	 * @example { compressionLevel: 4 }        // faster compression
	 */
	png?: Omit<PngOptions, 'force'>;
	/** Control dev-server behavior.
	 *
	 * - `true` — enable with defaults (default)
	 * - `false` — disable serve plugin entirely (build-only)
	 * - Object — fine-grained control
	 * @default true */
	dev?: boolean | DevOptions;
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

/** Valid string values for {@link PluginOptions.emitSizes}. */
export const EMIT_SIZES_FORMATS = ['png', 'ico', 'both'] as const;
/** Format for individually-emitted per-size files. */
export type EmitSizesFormat = (typeof EMIT_SIZES_FORMATS)[number];

/** Valid string values for {@link PluginOptions.dev} injection mode. */
export const DEV_INJECTIONS = ['transform', 'shim'] as const;
/** How favicon tags are injected during dev. */
export type DevInjection = (typeof DEV_INJECTIONS)[number];

/** Fine-grained control over dev-server behavior. */
export interface DevOptions {
	/** Enable dev-server features entirely. @default true */
	enabled?: boolean;
	/** How favicon tags appear during dev.
	 * - 'transform' — rewrite HTML via transformIndexHtml (current behavior, default)
	 * - 'shim' — inject a runtime script that manages <link> tags dynamically.
	 *   Useful for backend-rendered HTML or SPA shells not served by Vite's HTML pipeline.
	 * @default 'transform' */
	injection?: DevInjection;
	/** Auto-refresh favicon in browser when source file changes. @default true */
	hmr?: boolean;
}

/** Valid string values for {@link PluginOptions.inject}. */
export const INJECT_MODES = ['minimal', 'full'] as const;
/** Mode for HTML `<link>` tag injection. */
export type InjectMode = (typeof INJECT_MODES)[number];

/** Supported input image formats (sharp-compatible file extensions including the leading dot). */
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

/** Extensions that identify SVG input (`.svg` and `.svgz`). */
export const SVG_EXTENSIONS = new Set(['.svg', '.svgz']);
