/** Configuration for the [`vite-svg-to-ico`](https://github.com/kjanat/vite-svg-to-ico "GitHub") plugin.
 * @see https://npmjs.com/package/vite-svg-to-ico#options
 */
export interface PluginOptions {
	/** Absolute or root-relative path to the source SVG file. */
	input: string;
	/** Output filename for the generated `.ico` asset.
	 * @default 'favicon.ico' */
	output?: string;
	/** Pixel dimensions to rasterize (each value produces a square PNG layer).
	 *
	 * A single value is wrapped into an array automatically.
	 * Must be integers in the range 1–256 per the ICO spec.
	 * @default [16, 32, 48] */
	sizes?: IconSize | IconSize[];
	/** Apply maximum PNG compression (level 9 + adaptive filtering).
	 * @default true */
	optimize?: boolean;
	/** Copy over the input SVG file to the output directory alongside the ICO.
	 *
	 * Pass `true` to emit with the original basename, or an object to customise.
	 * @default false */
	includeSource?: boolean | IncludeSourceOptions;
}

/** Common ICO pixel dimensions with IDE autocompletion; any integer 1–256 is accepted. */
export type IconSize = 16 | 24 | 32 | 48 | 64 | 128 | 256 | (number & {});

/** Fine-grained control for emitting the source SVG alongside the ICO. */
export interface IncludeSourceOptions {
	/** Override the output filename for the emitted SVG.
	 * @default basename(input) */
	name?: string;
	/** Whether to emit the source SVG.
	 * @default true */
	enabled?: boolean;
}
