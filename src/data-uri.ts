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
 * Percent-escape a UTF-8 SVG string for use inside a `data:` URI that will
 * itself sit in an HTML double-quoted attribute.
 *
 * Every escape is a percent-encoding, so the original bytes are recovered
 * verbatim when the browser decodes the URI: the embedded favicon is identical
 * to the source down to whitespace and quotes. CDATA, `xml:space="preserve"`
 * text, and `<style>`/`<script>` content all survive unchanged.
 *
 * Only the characters that would break the URI or the surrounding attribute are
 * touched — far fewer than `encodeURIComponent` would encode, so the payload
 * stays compact and human-readable:
 *
 * - `%` first, so the encodings added below are not themselves re-encoded.
 * - `"` → `%22` closes the HTML attribute otherwise (we do NOT swap it to `'`,
 *   which would change the bytes inside CDATA/CSS/script).
 * - `&` → `%26` is unsafe in an HTML attribute under renderers that don't escape
 *   `&` themselves (the CLI's `renderTag` only escapes `"`).
 * - `#` → `%23` would otherwise start a URL fragment.
 * - `<` / `>` → `%3C` / `%3E` close out of the attribute / are invalid in a URI.
 */
function escapeSvgUtf8(svg: string): string {
  return svg
    .replace(/%/g, '%25')
    .replace(/"/g, '%22')
    .replace(/&/g, '%26')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E');
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
