import type { SizedPng } from '#raster';

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
 * @param pngs - Array of pre-rendered PNG buffers with their target sizes.
 * @returns ICO file contents as a {@link Buffer}.
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
