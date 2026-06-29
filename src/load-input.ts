/**
 * Input loading helpers. A source image may be:
 *
 * - a filesystem path string (`'./icon.svg'`, `'/abs/icon.svg'`),
 * - a `file://` URL — string or {@link URL} instance,
 * - an `http(s)://` URL — string or {@link URL} instance.
 *
 * {@link normalizeInput} canonicalises any of those into a string that is
 * either a filesystem path or an `http(s)://` URL; the rest of the codebase
 * operates on that string. URL inputs are fetched via the global `fetch`; the
 * URL's pathname (sans query string) drives basename/extension detection so
 * `https://example.com/icon.svg?v=2` is still recognised as SVG and copied
 * out as `icon.svg`.
 */

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Anything the plugin/CLI accept as a source image reference. */
export type SourceInput = string | URL;

/**
 * Reduce {@link SourceInput} to a canonical string: either a filesystem path
 * or an `http(s)://` URL. {@link URL} instances and `file://` strings are
 * converted to paths via {@link fileURLToPath}; other URL strings pass through.
 *
 * @throws TypeError when given a `URL` with a protocol other than `file:`,
 *   `http:`, or `https:` — the caller picked the wrong abstraction.
 */
export function normalizeInput(input: SourceInput): string {
  if (input instanceof URL) {
    if (input.protocol === 'file:') return fileURLToPath(input);
    if (input.protocol === 'http:' || input.protocol === 'https:') return input.toString();
    throw new TypeError(
      `[svg-to-ico] Unsupported URL protocol: "${input.protocol}" (expected file:, http:, or https:).`,
    );
  }
  if (input.startsWith('file://')) return fileURLToPath(input);
  return input;
}

/** Whether `input` resolves to an `http(s)://` URL (case-insensitive on scheme). */
export function isHttpUrl(input: SourceInput): boolean {
  return /^https?:\/\//i.test(normalizeInput(input));
}

/**
 * Logical filename for `input`. For paths, this is `basename(input)`. For
 * `http(s)://` URLs, it's the trailing path segment — query strings stripped —
 * falling back to `'favicon'` when the URL has no path (e.g. `https://example.com`).
 */
export function inputBasename(input: SourceInput): string {
  const s = normalizeInput(input);
  if (!/^https?:\/\//i.test(s)) return basename(s);
  try {
    const name = basename(new URL(s).pathname);
    return name || 'favicon';
  } catch {
    return basename(s);
  }
}

/** Lowercased extension (including leading dot) of `input`, URL-aware. */
export function inputExtname(input: SourceInput): string {
  return extname(inputBasename(input)).toLowerCase();
}

/**
 * Read `input` bytes from disk or fetch them over http(s). `file://` URLs and
 * {@link URL} instances are accepted alongside plain strings.
 *
 * URL fetches that return a non-2xx response throw with a message containing
 * the URL and status so failures are diagnosable from CLI/log output.
 */
export async function loadInputBytes(input: SourceInput): Promise<Buffer> {
  const s = normalizeInput(input);
  if (!/^https?:\/\//i.test(s)) return readFile(s);

  const res = await fetch(s);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${s}: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
