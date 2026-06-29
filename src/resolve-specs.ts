/**
 * Resolution layer between the user-facing {@link EmitSpec} array and the
 * plugin's emit/inject machinery.
 *
 * Given a normalized {@link EmitSpec}[] + the input format, produce:
 *
 * - `files`: a flat list of files to write to disk (or serve in dev), each
 *   labelled with the source PNG size it needs (or "source-copy" for the SVG).
 * - `injections`: a flat list of `<link>` tag specs to inject into HTML, with
 *   `href` *unresolved* — the call site is responsible for prepending the
 *   Vite `base` and applying cache-busting.
 * - `requiredSizes`: the union of every size mentioned in any spec, so the
 *   plugin can call `generateSizedPngs(input, { sizes: requiredSizes })` once
 *   and look up PNGs by size when producing each file.
 *
 * This module knows nothing about Vite, sharp, or filesystems — it's a pure
 * data transform. The plugin layer plugs it into `emitFile`, dev middleware,
 * and `transformIndexHtml`.
 */

import type { EmitSpec, IconSize } from '#types';

/** One file the plugin will produce on disk (build) or serve at a URL (dev). */
export interface ResolvedFile {
  /** Path relative to output dir (build) or URL path (dev). */
  filename: string;
  /** MIME sub-type without the `image/` prefix (e.g. `'x-icon'`, `'png'`, `'svg+xml'`). */
  mime: string;
  /** How to produce this file's bytes. */
  source: ResolvedFileSource;
}

/**
 * How a {@link ResolvedFile}'s bytes are produced. Discriminated by `kind`:
 *
 * - `combined-ico` — pack multiple PNG sizes into one ICO container.
 * - `single-ico` — wrap exactly one PNG size in a single-entry ICO.
 * - `png` — emit the PNG for one size as-is.
 * - `source-copy` — copy the original input file (SVG inputs only).
 */
export type ResolvedFileSource =
  | { kind: 'combined-ico'; sizes: IconSize[] }
  | { kind: 'single-ico'; size: IconSize }
  | { kind: 'png'; size: IconSize }
  | { kind: 'source-copy' };

/** One `<link>` tag to inject. The plugin layer fills in `base` and cache-bust on the href. */
export interface ResolvedInjection {
  tag: 'link';
  rel: 'icon';
  type: string;
  /** Path relative to base, e.g. `'favicon.ico'`, `'favicon-16x16.png'`, `'logo.svg'`. */
  filename: string;
  /** Optional `sizes` attribute (`'16x16 32x32'` for ICO, `'any'` for SVG, `'NxN'` for per-size PNG). */
  sizes?: string;
}

/** Output of {@link resolveSpecs}. */
export interface SpecResolution {
  files: ResolvedFile[];
  injections: ResolvedInjection[];
  /** Union of every size mentioned in any spec — feed this to `generateSizedPngs`. */
  requiredSizes: IconSize[];
  /** Whether at least one spec produces a source-copy (drives `inputBuffer` read in the plugin). */
  needsSourceCopy: boolean;
  /** Whether at least one spec has `inject: true` (drives the no-op warning when transformIndexHtml never fires). */
  hasAnyInjection: boolean;
}

/** Resolve normalized specs into the file and injection lists the plugin layer consumes. */
export function resolveSpecs(specs: EmitSpec[], ctx: { inputFormat: string }): SpecResolution {
  const files: ResolvedFile[] = [];
  const injections: ResolvedInjection[] = [];
  const sizeSet = new Set<IconSize>();
  let needsSourceCopy = false;

  for (const spec of specs) {
    switch (spec.format) {
      case 'ico': {
        const sizes = spec.sizes ?? [];
        const filename = spec.filename ?? 'favicon.ico';
        for (const s of sizes) sizeSet.add(s);
        const [only] = sizes;
        const source: ResolvedFileSource =
          sizes.length === 1 && only !== undefined
            ? { kind: 'single-ico', size: only }
            : { kind: 'combined-ico', sizes };
        files.push({ filename, mime: 'x-icon', source });
        if (spec.inject) {
          injections.push({
            tag: 'link',
            rel: 'icon',
            type: 'image/x-icon',
            filename,
            sizes: sizes.map((s) => `${s}x${s}`).join(' '),
          });
        }
        break;
      }
      case 'png': {
        const tmpl = spec.filenameTemplate ?? 'favicon-{size}x{size}.png';
        const injectMode = spec.inject;
        const injectSizes =
          injectMode === true
            ? new Set(spec.sizes)
            : injectMode && typeof injectMode === 'object' && injectMode.sizes
              ? new Set(injectMode.sizes)
              : null;
        for (const size of spec.sizes) {
          sizeSet.add(size);
          const filename = tmpl.replace(/\{size\}/g, String(size));
          files.push({ filename, mime: 'png', source: { kind: 'png', size } });
          if (injectSizes?.has(size)) {
            injections.push({
              tag: 'link',
              rel: 'icon',
              type: 'image/png',
              filename,
              sizes: `${size}x${size}`,
            });
          }
        }
        break;
      }
      case 'svg': {
        // Source copy is only meaningful for SVG inputs.
        if (ctx.inputFormat !== 'svg') break;
        needsSourceCopy = true;
        const filename = spec.filename ?? 'favicon.svg';
        files.push({ filename, mime: 'svg+xml', source: { kind: 'source-copy' } });
        if (spec.inject) {
          injections.push({
            tag: 'link',
            rel: 'icon',
            type: 'image/svg+xml',
            filename,
            sizes: 'any',
          });
        }
        break;
      }
    }
  }

  return {
    files,
    injections,
    requiredSizes: [...sizeSet].sort((a, b) => a - b),
    needsSourceCopy,
    hasAnyInjection: injections.length > 0,
  };
}
