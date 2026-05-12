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
	/** Default ICO filename, used as a fallback when an {@link IcoSpec} omits `filename`.
	 *
	 * @deprecated In v3, prefer specifying `filename` on an {@link IcoSpec}
	 *   inside the `emit` array. Retained for the v2 shim and as a fallback.
	 * @default 'favicon.ico'
	 */
	output?: string;
	/** Default pixel dimensions for the combined ICO when an {@link IcoSpec} omits `sizes`.
	 *
	 * A single value is wrapped into an array automatically.
	 * Must be integers in the range 1–256 per the ICO spec.
	 * @default [16, 32, 48]
	 */
	sizes?: IconSize | IconSize[];
	/** What this plugin emits and how it injects tags.
	 *
	 * **v3 shape** — an array of per-format specs (recommended):
	 *
	 * ```ts
	 * emit: [
	 *   { format: 'ico', sizes: [16, 32, 48] },
	 *   { format: 'png', sizes: [192, 512], inject: { sizes: [192] } },
	 *   { format: 'svg', filename: 'logo.svg', inject: true },
	 * ]
	 * ```
	 *
	 * **v2 shape** — `{ source, sizes, inject }` object. Still accepted; the
	 *   plugin translates it to v3 internally and logs a one-time deprecation
	 *   warning. Will be removed in v4.
	 *
	 * Omitted entirely → defaults to `[{ format: 'ico' }]` (one combined
	 *   favicon.ico using top-level `sizes`).
	 */
	emit?: EmitSpec[] | LegacyEmitOptions;
	/** Sharp image processing options. */
	sharp?: SharpOptions;
	/** Control dev-server behavior.
	 *
	 * - `true` — enable with defaults (default)
	 * - `false` — disable serve plugin entirely (build-only)
	 * - Object — fine-grained control
	 * @default true */
	dev?: boolean | DevOptions;
}

/** Discriminated union of v3 emit specs. Each entry produces one output. */
export type EmitSpec = IcoSpec | PngSpec | SvgSpec;

/** Valid format discriminators for {@link EmitSpec}. */
export const EMIT_FORMATS = ['ico', 'png', 'svg'] as const;
/** Format discriminator string for {@link EmitSpec}. */
export type EmitFormat = (typeof EMIT_FORMATS)[number];

/** Emit a multi-size ICO container. */
export interface IcoSpec {
	format: 'ico';
	/** Sizes to pack into this ICO (1–256). Falls back to {@link PluginOptions.sizes} when omitted. */
	sizes?: IconSize[];
	/** Output filename for this ICO. Falls back to {@link PluginOptions.output} or `'favicon.ico'`. */
	filename?: string;
	/** Inject a `<link rel="icon" type="image/x-icon">` tag pointing at this ICO. @default false */
	inject?: boolean;
}

/** Emit one PNG file per requested size. */
export interface PngSpec {
	format: 'png';
	/** Sizes to emit as individual PNG files (1–4096). Required — no implicit default.
	 *
	 * Standalone PNGs aren't bound by ICO's 8-bit width/height field — sizes
	 * like `192` (Android), `512` (PWA manifest), `1024` (retina) are all valid.
	 */
	sizes: IconSize[];
	/** Filename template using `{size}` as a placeholder. @default `'favicon-{size}x{size}.png'` */
	filenameTemplate?: string;
	/** Inject `<link rel="icon" type="image/png">` tags.
	 *
	 * - `true` — inject one tag per size in {@link sizes}.
	 * - `false` — inject nothing (default).
	 * - `{ sizes }` — inject tags only for the listed sizes (must be a subset of {@link sizes}). */
	inject?: boolean | { sizes?: IconSize[] };
}

/** Emit a copy of the source image (only meaningful when input is an SVG). */
export interface SvgSpec {
	format: 'svg';
	/** Output filename for the copied source. Defaults to `basename(input)`. */
	filename?: string;
	/** Inject a `<link rel="icon" type="image/svg+xml">` tag pointing at this file. @default false */
	inject?: boolean;
}

/** v2 shape kept for backward compatibility; will be removed in v4. Use {@link EmitSpec}[] instead.
 *
 * @deprecated Use the v3 {@link EmitSpec}[] form on {@link PluginOptions.emit}.
 */
export interface LegacyEmitOptions {
	/** Copy the source file to output alongside the ICO.
	 *
	 * Pass `true` to emit with the original basename, or an object to customise.
	 * @default false
	 */
	source?: boolean | { name?: string; enabled?: boolean };
	/** Emit individual per-size files alongside the combined ICO.
	 *
	 * - `false` — only emit combined ICO (default)
	 * - `true` | `'png'` — emit PNG files for each size
	 * - `'ico'` — emit single-entry ICO files per size
	 * - `'both'` — emit both PNG and ICO per size
	 * @default false
	 */
	sizes?: boolean | EmitSizesFormat;
	/** Inject `<link>` tags for generated favicons into `index.html`.
	 *
	 * - `true` | `'minimal'` — ICO + SVG source (if SVG input + source emitted)
	 * - `'full'` — all emitted files (ICO, SVG, per-size PNGs)
	 * - `false` — no injection
	 * @default false
	 */
	inject?: boolean | InjectMode;
}

/** @deprecated Old name preserved for the v2 type export. Use {@link LegacyEmitOptions}. */
export type EmitOptions = LegacyEmitOptions;

/** Type guard: distinguishes v3 {@link EmitSpec}[] from v2 {@link LegacyEmitOptions} object. */
export function isLegacyEmit(emit: unknown): emit is LegacyEmitOptions {
	return emit !== null
		&& typeof emit === 'object'
		&& !Array.isArray(emit);
}

/** Resolved emit configuration after normalization: always an {@link EmitSpec}[] with no `undefined` slots. */
export interface NormalizedEmit {
	/** Resolved specs in execution order. */
	specs: EmitSpec[];
	/** Whether the input used the v2 {@link LegacyEmitOptions} shape (drives one-time deprecation warning). */
	wasLegacy: boolean;
}

/** Sharp image processing options. */
export interface SharpOptions {
	/** Apply maximum PNG compression (level 9 + adaptive filtering).
	 * @default true */
	optimize?: boolean;
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
