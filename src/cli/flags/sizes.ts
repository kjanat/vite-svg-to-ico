import { blue } from 'ansispeck';
import { flag } from 'dreamcli';

/**
 * Build the `--sizes` flag: an array of per-element-validated integers, each
 * restricted to `[1, 256]` per the ICO spec. Parsing and range-check live
 * inside the flag definition so the action handler can trust the value.
 */
export const sizesFlag = () =>
	flag
		.array(flag.number({ int: true, min: 1, max: 256 }))
		.alias('s')
		.default([16, 32, 48])
		.describe(`Pixel sizes (integers 1–256). Pass repeated: ${blue('-s16 -s32 -s48')}.`);
