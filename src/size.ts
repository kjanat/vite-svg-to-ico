/**
 * Branded pixel-size type and its sole constructor. `IconSize` is internal —
 * public option types accept plain `number` for ergonomics; values cross into
 * `IconSize` only through {@link parseSize}, which validates the range once at
 * the parse boundary. A branded number widens back to `number` freely, so
 * sharp and the ICO packer consume it without friction.
 */

/** A validated, positive integer pixel size. Construct via {@link parseSize}. */
export type IconSize = number & { readonly __iconSize: unique symbol };

/**
 * Validate `raw` as an integer in `[1, max]` and brand it as an {@link IconSize}.
 * The one sanctioned `number → IconSize` cast lives here, in the constructor.
 * @throws Error when out of range or not an integer.
 */
export function parseSize(raw: unknown, max: number): IconSize {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new Error(`Invalid size: ${String(raw)}. Must be an integer 1–${max}.`);
  }
  return n as IconSize;
}
