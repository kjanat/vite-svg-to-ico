import { describe, expect, it } from 'bun:test';

import { parseSize } from '#size';

describe('parseSize', () => {
  it('accepts an in-range integer', () => {
    expect(parseSize(48, 256)).toBe(48);
  });

  it('accepts up to max (PNG 4096)', () => {
    expect(parseSize(4096, 4096)).toBe(4096);
  });

  it('rejects non-integers', () => {
    expect(() => parseSize(16.5, 256)).toThrow(/integer/i);
  });

  it('rejects below 1', () => {
    expect(() => parseSize(0, 256)).toThrow(/1/);
  });

  it('rejects above max', () => {
    expect(() => parseSize(512, 256)).toThrow(/256/);
  });

  it('rejects non-numeric values', () => {
    expect(() => parseSize('big', 256)).toThrow();
  });
});
