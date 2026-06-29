import type { PngOptions, ResizeOptions } from 'sharp';

/** Configuration for the [`vite-svg-to-ico`](https://github.com/kjanat/vite-svg-to-ico "GitHub") plugin.
 * @see https://npmjs.com/package/vite-svg-to-ico#options
 */
export interface PluginOptions {
  /** Source image. Accepts:
   *
   * - an absolute / root-relative filesystem path,
   * - a `file://` URL (string or {@link URL} instance) — treated as a path,
   * - an `http(s)://` URL (string or {@link URL} instance) — fetched at
   *   build (and dev) time.
   *
   * Supports SVG, PNG, JPEG, WebP, AVIF, GIF, and TIFF via sharp. HTTP URL
   * inputs are fetched once per build; HMR (file watching) only applies to
   * local paths and `file://` URLs.
   */
  input: string | URL;
  /** Default ICO filename, used as a fallback when an {@link IcoSpec} omits `filename`.
   * @default 'favicon.ico'
   */
  output?: string;
  /** Default pixel dimensions for the combined ICO when an {@link IcoSpec} omits `sizes`.
   *
   * A single value is wrapped into an array automatically.
   * Must be integers in the range 1–256 per the ICO spec.
   * @default [16, 32, 48]
   */
  sizes?: number | number[];
  /** What this plugin emits and how it injects tags — an array of per-format specs:
   *
   * ```ts
   * emit: [
   *   { format: 'ico', sizes: [16, 32, 48] },
   *   { format: 'png', sizes: [192, 512], inject: { sizes: [192] } },
   *   { format: 'svg', filename: 'logo.svg', inject: true },
   * ]
   * ```
   *
   * Omitted entirely → defaults to `[{ format: 'ico' }]` (one combined
   *   favicon.ico using top-level `sizes`).
   */
  emit?: EmitSpec[];
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
  /** Write the ICO file to disk (or serve it in dev).
   *
   * Set `false` to skip the file entirely — only meaningful alongside
   * `inject: 'embed'`, which inlines the bytes into the HTML instead.
   * @default true */
  emit?: boolean;
  /** Inject a `<link rel="icon" type="image/x-icon">` tag for this ICO.
   *
   * - `false` — no tag (default). Browsers still auto-request `/favicon.ico`,
   *   so an emit-only ICO already works as a silent fallback.
   * - `true` — tag whose `href` points at the emitted file.
   * - `'embed'` — tag whose `href` inlines the ICO bytes as a base64
   *   `data:` URI (no file reference). Combine with `emit: false` to embed
   *   without writing a file, or `emit: true` to do both.
   * @default false */
  inject?: boolean | 'embed';
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
  /** Write the PNG files to disk (or serve them in dev).
   *
   * Set `false` to skip the files — only meaningful with `inject: 'embed'`
   * (or `{ embed: true }`), which inlines each PNG as a base64 `data:` URI.
   * Note: inlining icon-sized PNGs defeats browser caching; prefer URL links
   * unless you specifically want a self-contained document.
   * @default true */
  emit?: boolean;
  /** Inject `<link rel="icon" type="image/png">` tags.
   *
   * - `false` — inject nothing (default).
   * - `true` — one URL tag per size in {@link sizes}.
   * - `'embed'` — one base64 `data:` URI tag per size in {@link sizes}.
   * - `{ sizes }` — tags only for the listed sizes (must be a subset of
   *   {@link sizes}). Omit `sizes` to target every size.
   * - `{ sizes, embed: true }` — as above, but inlined as `data:` URIs. */
  inject?: boolean | 'embed' | { sizes?: IconSize[]; embed?: boolean };
}

/** Emit a copy of the source image (only meaningful when input is an SVG). */
export interface SvgSpec {
  format: 'svg';
  /** Output filename for the copied source. Defaults to `basename(input)`. */
  filename?: string;
  /** Write the SVG file to disk (or serve it in dev).
   *
   * Set `false` to skip the file — only meaningful with `inject: 'embed'`,
   * which inlines the SVG into the HTML instead.
   * @default true */
  emit?: boolean;
  /** Inject a `<link rel="icon" type="image/svg+xml">` tag for this SVG.
   *
   * - `false` — no tag (default).
   * - `true` — tag whose `href` points at the emitted file.
   * - `'embed'` — tag whose `href` inlines the SVG as a `data:` URI (see
   *   {@link encoding}). Combine with `emit: false` to embed without writing
   *   a file ("all the way in there"), or `emit: true` to do both.
   * @default false */
  inject?: boolean | 'embed';
  /** Encoding used when `inject: 'embed'`.
   *
   * - `'base64'` (default) — `data:image/svg+xml;base64,…`. Opaque, uniform
   *   with binary formats, ~33% larger than the source.
   * - `'utf8'` — `data:image/svg+xml,…` with minimal percent-escaping. Keeps
   *   the markup human-readable and is typically smaller than base64.
   * @default 'base64' */
  encoding?: DataUriEncoding;
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

/** Valid encodings for an embedded (`inject: 'embed'`) favicon `data:` URI. */
export const DATA_URI_ENCODINGS = ['base64', 'utf8'] as const;
/** How embedded favicon bytes are encoded into a `data:` URI. See {@link SvgSpec.encoding}. */
export type DataUriEncoding = (typeof DATA_URI_ENCODINGS)[number];

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
