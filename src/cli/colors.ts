/**
 * Terminal color helpers for CLI help and output.
 *
 * Each export wraps a string in an ANSI foreground color plus an automatic
 * reset, so callers can't bleed color into the next segment by forgetting a
 * reset. Nest by concatenating segments (`blue('a') + red('b')`) rather than
 * embedding one helper's output inside another — every segment self-resets.
 *
 * Color is resolved once at import time:
 * - suppressed when `NO_COLOR` is set (per https://no-color.org, any value),
 * - forced on when `FORCE_COLOR` is set (useful for piped/CI output),
 * - otherwise enabled only for an interactive, non-`dumb` stdout.
 *
 * When disabled, every helper returns its input verbatim — safe to pipe into
 * files or pagers without leaking escape codes.
 */

const env = process.env;

/** Whether to emit ANSI color, decided once from env + stdout at import time. */
const useColor: boolean =
  'NO_COLOR' in env ? false : 'FORCE_COLOR' in env ? true : process.stdout.isTTY === true && env['TERM'] !== 'dumb';

/** Build a color helper wrapping its input in `code` and a trailing reset. */
const colorize =
  (code: number) =>
  (text: string): string =>
    useColor ? `\x1b[${code}m${text}\x1b[0m` : text;

/** Wrap text in blue — used for flags, commands, and HTML/markup syntax. */
export const blue = colorize(34);
/** Wrap text in red — used for literal/enum values and URL schemes. */
export const red = colorize(31);
/** Wrap text in green — used for whole example command lines. */
export const green = colorize(32);
