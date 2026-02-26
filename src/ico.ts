import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

/**
 * Rasterize an SVG to multiple PNG sizes and pack them into an ICO buffer.
 *
 * @param svg      - SVG contents as a Buffer, or a filesystem path to read.
 * @param sizes    - Square pixel dimensions for each PNG layer.
 * @param optimize - Whether to use maximum PNG compression.
 * @returns ICO file contents as a {@link Buffer}.
 */
export async function generateIco(
	svg: Buffer | string,
	sizes: number[],
	optimize: boolean,
): Promise<Buffer> {
	const svgBuffer = Buffer.isBuffer(svg) ? svg : await readFile(svg);

	const pngBuffers = await Promise.all(
		sizes.map((size) =>
			sharp(svgBuffer)
				.resize(size, size, {
					fit: 'contain',
					background: { r: 0, g: 0, b: 0, alpha: 0 },
				})
				.png({
					compressionLevel: optimize ? 9 : 6,
					adaptiveFiltering: optimize,
				})
				.toBuffer()
		),
	);

	return packIco(pngBuffers, sizes);
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
function packIco(pngs: Buffer[], sizes: number[]): Buffer {
	const count = pngs.length;
	const dataOffset = HEADER_SIZE + count * ENTRY_SIZE;

	const header = Buffer.alloc(HEADER_SIZE);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(ICO_TYPE, 2); // type
	header.writeUInt16LE(count, 4); // image count

	let offset = dataOffset;
	const entries = Buffer.alloc(count * ENTRY_SIZE);

	for (const [i, [png, size]] of pngs.map((p, j) => [p, sizes[j] ?? 0] as const).entries()) {
		const pos = i * ENTRY_SIZE;

		entries.writeUInt8(size >= 256 ? 0 : size, pos); // width (0 = 256)
		entries.writeUInt8(size >= 256 ? 0 : size, pos + 1); // height (0 = 256)
		entries.writeUInt8(0, pos + 2); // color palette count
		entries.writeUInt8(0, pos + 3); // reserved
		entries.writeUInt16LE(1, pos + 4); // color planes
		entries.writeUInt16LE(32, pos + 6); // bits per pixel
		entries.writeUInt32LE(png.length, pos + 8); // image data size
		entries.writeUInt32LE(offset, pos + 12); // absolute offset

		offset += png.length;
	}

	return Buffer.concat([header, entries, ...pngs]);
}
