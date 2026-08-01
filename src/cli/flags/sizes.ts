import { blue } from 'ansispeck/safe';
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
		.describe(`Pixel sizes (integers 1–256). Pass repeated: ${blue`-s16 -s32 -s48`}.`);

/**
 * Build the `--png-sizes` flag: which standalone PNGs get their own
 * `<link rel="icon" type="image/png">`. Standalone PNGs are not bound by ICO's
 * 8-bit width/height field, so the ceiling is 4096 rather than 256. Empty means
 * no PNG tags.
 */
export const pngSizesFlag = () =>
	flag
		.array(flag.number({ int: true, min: 1, max: 4096 }))
		.default([])
		.describe(
			`Sizes (integers 1–4096) to emit a per-size PNG ${blue`<link>`} for, matching the files \
${blue`generate --emit-sizes png`} writes. Pass repeated: ${blue`--png-sizes 192 --png-sizes 512`}.`,
		);
