import { CLIError, flag } from '@kjanat/dreamcli';

import { blue } from '#cli/colors';

/**
 * Build the `--sizes` flag: an array of per-element-validated integers, each
 * restricted to `[1, 256]` per the ICO spec. Parsing and range-check live
 * inside the flag definition so the action handler can trust the value.
 */
export const sizesFlag = () =>
  flag
    .array(
      flag.custom<number>((raw) => {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 256) {
          throw new CLIError(`Invalid size: ${String(raw)}. Must be an integer 1–256.`, { code: 'INVALID_SIZE' });
        }
        return n;
      }),
    )
    .alias('s')
    .default([16, 32, 48])
    .describe(`Pixel sizes (integers 1–256). Pass repeated: ${blue('-s16 -s32 -s48')}.`);
