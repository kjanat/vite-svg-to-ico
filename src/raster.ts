import { readFile } from 'node:fs/promises';
import type { PngOptions, ResizeOptions } from 'sharp';
import sharp from 'sharp';

import { packIco } from '#ico';

/** Result of rasterizing a single size from the input image. */
export interface SizedPng {
	size: number;
	buffer: Buffer;
}

/** Options for {@link generateSizedPngs} and {@link generateIco}. */
export interface GenerateOptions {
	/** Square pixel dimensions for each PNG layer. */
	sizes: number[];
	/** Whether to use maximum PNG compression (level 9 + adaptive filtering).
	 * Overridden by explicit values in {@link png} when both are set. */
	optimize: boolean;
	/** Sharp resize options merged over defaults.
	 * `width` and `height` are always set by the per-size value. */
	resize?: Omit<ResizeOptions, 'width' | 'height'>;
	/** Sharp PNG output options merged over defaults derived from {@link optimize}. */
	png?: Omit<PngOptions, 'force'>;
}

/** Default resize options applied when no overrides are provided. */
const DEFAULT_RESIZE: Omit<ResizeOptions, 'width' | 'height'> = {
	fit: 'contain',
	background: { r: 0, g: 0, b: 0, alpha: 0 },
};

/**
 * Rasterize an input image to individual per-size PNG buffers.
 *
 * @param input - Image contents as a Buffer, or a filesystem path to read.
 * @param opts  - Generation options including sizes, optimization, and sharp overrides.
 * @returns Array of sized PNG buffers.
 */
export async function generateSizedPngs(input: Buffer | string, opts: GenerateOptions): Promise<SizedPng[]> {
	const inputBuffer = Buffer.isBuffer(input) ? input : await readFile(input);

	const resizeOpts: Omit<ResizeOptions, 'width' | 'height'> = { ...DEFAULT_RESIZE, ...opts.resize };
	const pngOpts: PngOptions = {
		compressionLevel: opts.optimize ? 9 : 6,
		adaptiveFiltering: opts.optimize,
		...opts.png,
	};

	return Promise.all(
		opts.sizes.map(async (size) => ({
			size,
			buffer: await sharp(inputBuffer).resize(size, size, resizeOpts).png(pngOpts).toBuffer(),
		})),
	);
}

/**
 * Rasterize an input image to multiple PNG sizes and pack them into an ICO buffer.
 *
 * @param input - Image contents as a Buffer, or a filesystem path to read.
 * @param opts  - Generation options including sizes, optimization, and sharp overrides.
 * @returns ICO file contents as a {@link Buffer}.
 */
export async function generateIco(input: Buffer | string, opts: GenerateOptions): Promise<Buffer> {
	// ICO directory entries store width/height in a single byte where 0 means
	// exactly 256px, so only 1–256 can be represented honestly.
	const invalid = opts.sizes.filter((s) => s < 1 || s > 256);
	if (invalid.length > 0) {
		throw new RangeError(`ICO layers must be 1–256px; got ${invalid.join(', ')}.`);
	}
	const pngs = await generateSizedPngs(input, opts);
	return packIco(pngs);
}
