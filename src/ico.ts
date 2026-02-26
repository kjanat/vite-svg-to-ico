import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { PngOptions, ResizeOptions } from 'sharp';

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
export async function generateSizedPngs(
	input: Buffer | string,
	opts: GenerateOptions,
): Promise<SizedPng[]> {
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
			buffer: await sharp(inputBuffer)
				.resize(size, size, resizeOpts)
				.png(pngOpts)
				.toBuffer(),
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
export async function generateIco(
	input: Buffer | string,
	opts: GenerateOptions,
): Promise<Buffer> {
	const pngs = await generateSizedPngs(input, opts);
	return packIco(pngs);
}

/** ICO type identifier (1 = icon, 2 = cursor). */
const ICO_TYPE = 1;
/** Byte length of the ICONDIR header. */
const HEADER_SIZE = 6;
/** Byte length of a single ICONDIRENTRY. */
const ENTRY_SIZE = 16;

/**
 * Pack pre-rendered PNG buffers into an ICO container.
 *
 * Uses the modern PNG-in-ICO format (supported since Windows Vista).
 * Each PNG is stored verbatim — no BMP conversion or pixel manipulation.
 *
 * @see {@link https://en.wikipedia.org/wiki/ICO_(file_format) "ICO (file format)"}
 */
export function packIco(pngs: SizedPng[]): Buffer {
	const count = pngs.length;
	const dataOffset = HEADER_SIZE + count * ENTRY_SIZE;

	const header = Buffer.alloc(HEADER_SIZE);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(ICO_TYPE, 2); // type
	header.writeUInt16LE(count, 4); // image count

	let offset = dataOffset;
	const entries = Buffer.alloc(count * ENTRY_SIZE);

	for (const [i, png] of pngs.entries()) {
		const pos = i * ENTRY_SIZE;

		entries.writeUInt8(png.size >= 256 ? 0 : png.size, pos); // width (0 = 256)
		entries.writeUInt8(png.size >= 256 ? 0 : png.size, pos + 1); // height (0 = 256)
		entries.writeUInt8(0, pos + 2); // color palette count
		entries.writeUInt8(0, pos + 3); // reserved
		entries.writeUInt16LE(1, pos + 4); // color planes
		entries.writeUInt16LE(32, pos + 6); // bits per pixel
		entries.writeUInt32LE(png.buffer.length, pos + 8); // image data size
		entries.writeUInt32LE(offset, pos + 12); // absolute offset

		offset += png.buffer.length;
	}

	return Buffer.concat([header, entries, ...pngs.map((p) => p.buffer)]);
}
