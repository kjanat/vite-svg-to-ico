import { describe, expect, it } from 'bun:test';

import { buildFaviconTags } from '#internals/html.ts';
import { unwrap } from './_helpers.ts';

describe('buildFaviconTags', () => {
  it('minimal mode: returns ICO tag only for non-SVG input', () => {
    const tags = buildFaviconTags({
      output: 'favicon.ico',
      sizes: [16, 32],
      sourceEmitted: false,
      sourceName: 'icon.png',
      inputFormat: 'png',
      mode: 'minimal',
    });
    expect(tags).toHaveLength(1);
    const attrs = unwrap(unwrap(tags[0]).attrs);
    expect(attrs['type']).toBe('image/x-icon');
    expect(attrs['href']).toBe('/favicon.ico');
    expect(attrs['sizes']).toBe('16x16 32x32');
  });

  it('minimal mode: includes SVG tag when SVG input + source emitted', () => {
    const tags = buildFaviconTags({
      output: 'favicon.ico',
      sizes: [16, 32],
      sourceEmitted: true,
      sourceName: 'icon.svg',
      inputFormat: 'svg',
      mode: 'minimal',
    });
    expect(tags).toHaveLength(2);
    const svgAttrs = unwrap(unwrap(tags[1]).attrs);
    expect(svgAttrs['type']).toBe('image/svg+xml');
    expect(svgAttrs['href']).toBe('/icon.svg');
  });

  it('minimal mode: no SVG tag when source not emitted', () => {
    const tags = buildFaviconTags({
      output: 'favicon.ico',
      sizes: [16],
      sourceEmitted: false,
      sourceName: 'icon.svg',
      inputFormat: 'svg',
      mode: 'minimal',
    });
    expect(tags).toHaveLength(1);
  });

  it('full mode: includes per-size file tags', () => {
    const tags = buildFaviconTags({
      output: 'favicon.ico',
      sizes: [16, 32],
      sourceEmitted: false,
      sourceName: 'icon.png',
      inputFormat: 'png',
      mode: 'full',
      sizedFiles: [
        { name: 'favicon-16x16.png', size: 16, format: 'png' },
        { name: 'favicon-32x32.png', size: 32, format: 'png' },
      ],
    });
    // 1 ICO + 2 per-size
    expect(tags).toHaveLength(3);
    expect(unwrap(unwrap(tags[1]).attrs)['sizes']).toBe('16x16');
    expect(unwrap(unwrap(tags[2]).attrs)['sizes']).toBe('32x32');
  });

  it('full mode without sizedFiles: no per-size tags', () => {
    const tags = buildFaviconTags({
      output: 'favicon.ico',
      sizes: [16],
      sourceEmitted: false,
      sourceName: 'icon.png',
      inputFormat: 'png',
      mode: 'full',
    });
    expect(tags).toHaveLength(1);
  });

  it('all tags inject to head', () => {
    const tags = buildFaviconTags({
      output: 'favicon.ico',
      sizes: [16],
      sourceEmitted: true,
      sourceName: 'icon.svg',
      inputFormat: 'svg',
      mode: 'full',
      sizedFiles: [{ name: 'favicon-16x16.png', size: 16, format: 'png' }],
    });
    for (const tag of tags) {
      expect(tag.injectTo).toBe('head');
    }
  });
});
