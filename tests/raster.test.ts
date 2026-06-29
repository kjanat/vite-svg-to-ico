import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { generateIco, generateSizedPngs } from '#raster';
import { unwrap } from './_helpers.ts';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/test.svg');

describe('generateSizedPngs', () => {
  it('returns correct number of PNGs for given sizes', async () => {
    const pngs = await generateSizedPngs(FIXTURE, { sizes: [16, 32], optimize: false });
    expect(pngs).toHaveLength(2);
    expect(unwrap(pngs[0]).size).toBe(16);
    expect(unwrap(pngs[1]).size).toBe(32);
  });

  it('accepts a Buffer input', async () => {
    const buf = await readFile(FIXTURE);
    const pngs = await generateSizedPngs(buf, { sizes: [16], optimize: false });
    expect(pngs).toHaveLength(1);
    expect(unwrap(pngs[0]).buffer).toBeInstanceOf(Buffer);
  });

  it('produces valid PNG buffers (PNG magic bytes)', async () => {
    const pngs = await generateSizedPngs(FIXTURE, { sizes: [32], optimize: false });
    const magic = unwrap(pngs[0]).buffer.subarray(0, 4);
    expect(magic[0]).toBe(0x89);
    expect(magic[1]).toBe(0x50); // P
    expect(magic[2]).toBe(0x4e); // N
    expect(magic[3]).toBe(0x47); // G
  });

  it('respects optimize flag (produces different output)', async () => {
    const [unopt] = await generateSizedPngs(FIXTURE, { sizes: [48], optimize: false });
    const [opt] = await generateSizedPngs(FIXTURE, { sizes: [48], optimize: true });
    // Optimize changes compression settings, so buffers should differ
    expect(unwrap(opt).buffer.equals(unwrap(unopt).buffer)).toBe(false);
  });

  it('handles size 256', async () => {
    const pngs = await generateSizedPngs(FIXTURE, { sizes: [256], optimize: false });
    expect(unwrap(pngs[0]).size).toBe(256);
  });
});

describe('generateIco', () => {
  it('returns a valid ICO buffer from path', async () => {
    const ico = await generateIco(FIXTURE, { sizes: [16, 32], optimize: false });
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
  });
});
