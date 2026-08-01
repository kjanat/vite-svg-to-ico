import { flag } from 'dreamcli';

/**
 * Filename both commands fall back to. Browsers request `/favicon.ico` without
 * a `<link>` tag, so it is the one name that works with no HTML at all.
 */
export const DEFAULT_ICO_FILENAME = 'favicon.ico';

/**
 * Shared parse surface for `--output`/`-o`. `generate` writes the ICO and
 * `inject` references it in the emitted `<link>`, so the two have to accept
 * the same spellings and reject the same values.
 *
 * The default and the description stay with each command: `inject` always has
 * a filename to point at, while `generate` leaves the flag unset so it can
 * tell an explicit `-o` from `--keep-name`.
 */
export const outputFlag = () => flag.string().nonEmpty().alias('o');
