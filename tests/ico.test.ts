import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { packIco } from '#ico';
import { generateSizedPngs, type SizedPng } from '#raster';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/test.svg');

describe('packIco', () => {
	it('produces valid ICO header (magic bytes)', async () => {
		const pngs = await generateSizedPngs(FIXTURE, { sizes: [16], optimize: false });
		const ico = packIco(pngs);
		// Reserved: 0, Type: 1 (icon), Count: 1
		expect(ico.readUInt16LE(0)).toBe(0); // reserved
		expect(ico.readUInt16LE(2)).toBe(1); // type = icon
		expect(ico.readUInt16LE(4)).toBe(1); // count
	});

	it('encodes correct entry count for multiple sizes', async () => {
		const pngs = await generateSizedPngs(FIXTURE, { sizes: [16, 32, 48], optimize: false });
		const ico = packIco(pngs);
		expect(ico.readUInt16LE(4)).toBe(3);
	});

	it('encodes size 256 as 0 in entry', async () => {
		const pngs: SizedPng[] = [{ size: 256, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }];
		const ico = packIco(pngs);
		// Entry starts at offset 6; width is byte 0, height byte 1
		expect(ico.readUInt8(6)).toBe(0); // width=0 means 256
		expect(ico.readUInt8(7)).toBe(0); // height=0 means 256
	});

	it('encodes normal sizes directly in entry', async () => {
		const pngs: SizedPng[] = [{ size: 32, buffer: Buffer.alloc(10) }];
		const ico = packIco(pngs);
		expect(ico.readUInt8(6)).toBe(32);
		expect(ico.readUInt8(7)).toBe(32);
	});

	it('embeds PNG data after header+entries', async () => {
		const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
		const pngs: SizedPng[] = [{ size: 16, buffer: pngData }];
		const ico = packIco(pngs);
		const dataOffset = 6 + 16; // header + 1 entry
		expect(ico.subarray(dataOffset, dataOffset + pngData.length)).toEqual(pngData);
	});

	it('records correct data offset and size in entry', async () => {
		const pngData = Buffer.alloc(42);
		const pngs: SizedPng[] = [{ size: 16, buffer: pngData }];
		const ico = packIco(pngs);
		const entryStart = 6;
		expect(ico.readUInt32LE(entryStart + 8)).toBe(42); // data size
		expect(ico.readUInt32LE(entryStart + 12)).toBe(6 + 16); // data offset
	});
});
