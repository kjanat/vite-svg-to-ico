import type { HtmlTagDescriptor } from 'vite';

import type { InjectMode } from '#types';

/** Metadata for a per-size emitted file. */
export interface SizedFileInfo {
  name: string;
  size: number;
  /** MIME sub-type, e.g. `'png'` or `'x-icon'`. */
  format: string;
}

/**
 * Resolve a favicon file to an inline `data:` URI, or `null` to keep the
 * URL href. Called once per `<link>`; the implementation (which reads bytes
 * and encodes them) is injected so {@link buildFaviconTags} stays pure.
 */
export type EmbedResolver = (file: { name: string; mime: string }) => string | null;

/** Inputs for building favicon `<link>` tag descriptors. */
export interface FaviconTagOptions {
  output: string;
  sizes: number[];
  sourceEmitted: boolean;
  sourceName: string;
  /** Detected input format: `'svg'`, `'png'`, `'jpg'`, etc. */
  inputFormat: string;
  mode: InjectMode;
  sizedFiles?: SizedFileInfo[];
  /** Vite resolved `base` path (e.g. `'/'`, `'#'`, `'/repo/'`). Defaults to `'/'`. */
  base?: string;
  /**
   * When provided, each `<link>`'s `href` is resolved through this function: a
   * returned string inlines the bytes as a `data:` URI, `null` keeps the
   * `base`-prefixed URL. Lets the CLI embed favicons without coupling this pure
   * builder to the filesystem.
   */
  embed?: EmbedResolver;
}

/**
 * Build an array of Vite {@link HtmlTagDescriptor}s for favicon `<link>` tags.
 *
 * - **minimal**: ICO (always) + SVG source (if SVG input & source emitted).
 * - **full**: minimal + per-size PNG `<link>` tags.
 *
 * @param opts - Configuration describing which tags to generate.
 * @returns Array of Vite HTML tag descriptors to inject into `<head>`.
 */
export function buildFaviconTags(opts: FaviconTagOptions): HtmlTagDescriptor[] {
  const tags: HtmlTagDescriptor[] = [];
  const baseRaw = opts.base ?? '/';
  const base = baseRaw.endsWith('/') ? baseRaw : `${baseRaw}/`;
  const withBase = (name: string) => `${base}${name.replace(/^\/+/, '')}`;
  // Inline as a data URI when `embed` opts in for this file, else URL href.
  const hrefFor = (name: string, mime: string) => opts.embed?.({ name, mime }) ?? withBase(name);

  // 1. ICO — always
  tags.push({
    tag: 'link',
    attrs: {
      rel: 'icon',
      type: 'image/x-icon',
      href: hrefFor(opts.output, 'image/x-icon'),
      sizes: opts.sizes.map((s) => `${s}x${s}`).join(' '),
    },
    injectTo: 'head',
  });

  // 2. SVG source — only for SVG input with source emitted
  if (opts.inputFormat === 'svg' && opts.sourceEmitted) {
    tags.push({
      tag: 'link',
      attrs: {
        rel: 'icon',
        type: 'image/svg+xml',
        href: hrefFor(opts.sourceName, 'image/svg+xml'),
        sizes: 'any',
      },
      injectTo: 'head',
    });
  }

  // 3. Per-size PNGs — full mode only
  if (opts.mode === 'full' && opts.sizedFiles) {
    for (const file of opts.sizedFiles) {
      tags.push({
        tag: 'link',
        attrs: {
          rel: 'icon',
          type: `image/${file.format}`,
          sizes: `${file.size}x${file.size}`,
          href: hrefFor(file.name, `image/${file.format}`),
        },
        injectTo: 'head',
      });
    }
  }

  return tags;
}
