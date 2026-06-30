import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import { AssetProducer } from '#assets';
import { parseConfig } from '#config';
import type { IconSize } from '#types';
import { invalid } from './_helpers.ts';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/test.svg');
const sizes = invalid<IconSize[]>([16, 32]);

function producer() {
  const cfg = parseConfig({ input: FIXTURE });
  return new AssetProducer(cfg, sizes);
}

describe('AssetProducer.produce', () => {
  it('source-copy returns the raw SVG bytes', async () => {
    const bytes = await producer().produce({ filename: 'x.svg', mime: 'svg+xml', source: { kind: 'source-copy' } });
    expect(bytes.toString()).toContain('<svg');
  });

  it('png returns a PNG of the requested size', async () => {
    const bytes = await producer().produce({
      filename: 'x.png',
      mime: 'png',
      source: { kind: 'png', size: invalid<IconSize>(16) },
    });
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('combined-ico packs an ICO with one entry per size', async () => {
    const bytes = await producer().produce({
      filename: 'f.ico',
      mime: 'x-icon',
      source: { kind: 'combined-ico', sizes },
    });
    expect(bytes.readUInt16LE(2)).toBe(1); // type = icon
    expect(bytes.readUInt16LE(4)).toBe(2); // 2 entries
  });
});

describe('AssetProducer caching', () => {
  it('pngs() returns the same instances on repeat (cached)', async () => {
    const p = producer();
    const first = await p.pngs();
    expect(await p.pngs()).toBe(first);
  });

  it('reset() forces regeneration', async () => {
    const p = producer();
    const first = await p.pngs();
    p.reset();
    expect(await p.pngs()).not.toBe(first);
  });
});

describe('AssetProducer.contentType', () => {
  it('maps svg+xml to the source mime, others to image/<mime>', () => {
    const p = producer();
    expect(p.contentType('svg+xml')).toBe('image/svg+xml');
    expect(p.contentType('x-icon')).toBe('image/x-icon');
  });
});
