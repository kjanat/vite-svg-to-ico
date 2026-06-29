/**
 * Build `data:` URIs for embedding favicon bytes directly into HTML, so a
 * `<link rel="icon">` can carry the image inline instead of pointing at a file.
 *
 * Two encodings ({@link DataUriEncoding}):
 *
 * - `base64` — `data:<mime>;base64,<…>`. Works for any bytes and is the only
 *   valid choice for binary formats (ICO, PNG). Costs ~33% over the raw size.
 * - `utf8` — `data:<mime>,<minimally-escaped text>`. Text formats only (SVG).
 *   Keeps the markup human-readable and is typically *smaller* than base64.
 *
 * Pure module: no Vite, sharp, or filesystem. The plugin feeds it bytes it has
 * already produced and splices the result into a `<link>` href.
 */

import type { DataUriEncoding } from '#types';

/**
 * Minimally percent-escape a UTF-8 SVG string for use inside a `data:` URI that
 * will itself sit in an HTML double-quoted attribute.
 *
 * Rather than `encodeURIComponent` (which escapes far more than necessary and
 * bloats the payload), this escapes only the characters that would actually
 * break the URI or the surrounding attribute, and swaps `"` → `'` so the markup
 * needs no attribute-level quote escaping. This mirrors the well-trodden
 * "tiny SVG data URI" approach.
 */
function escapeSvgUtf8(svg: string): string {
  return (
    svg
      // Collapse inter-tag and run whitespace — safe for SVG, shrinks the URI.
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .trim()
      // Single quotes in markup so the URI carries no `"` to escape in the attr.
      .replace(/"/g, "'")
      // Percent-encode the genuinely-unsafe characters. `%` first so the
      // substitutions below aren't themselves re-encoded. `&` is escaped so the
      // URI is safe inside an HTML attribute under renderers that don't escape
      // `&` themselves (the CLI's `renderTag` only escapes `"`).
      .replace(/%/g, '%25')
      .replace(/&/g, '%26')
      .replace(/#/g, '%23')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E')
  );
}

/**
 * Encode `bytes` as a `data:` URI with the given `mime` (full type, e.g.
 * `'image/svg+xml'`) and {@link DataUriEncoding}.
 *
 * `utf8` is intended for SVG only — it decodes the bytes as text. Binary
 * formats must use `base64`; the type system routes them there (only
 * {@link SvgSpec} exposes an `encoding` knob).
 */
export function toDataUri(bytes: Buffer, mime: string, encoding: DataUriEncoding): string {
  if (encoding === 'utf8') {
    return `data:${mime},${escapeSvgUtf8(bytes.toString('utf8'))}`;
  }
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
