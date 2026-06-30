import { describe, expect, it } from 'bun:test';

import { parseConfig } from '#config';
import type { PluginOptions } from '#types';
import { invalid } from './_helpers.ts';

describe('parseConfig — resolved shape', () => {
  it('fills defaults: single ico spec, default sizes, transform dev', () => {
    const cfg = parseConfig({ input: 'icon.svg' });
    expect(cfg.inputFormat).toBe('svg');
    expect(cfg.sourceMimeType).toBe('image/svg+xml');
    expect(cfg.sizes).toEqual([16, 32, 48]);
    expect(cfg.dev).toEqual({ enabled: true, injection: 'transform', hmr: true });
    expect(cfg.specs).toEqual([
      { format: 'ico', sizes: [16, 32, 48], filename: 'favicon.ico', emit: true, inject: false },
    ]);
  });

  it('wraps a single size and maps jpg mime', () => {
    const cfg = parseConfig({ input: 'icon.jpg', sizes: 32 });
    expect(cfg.sizes).toEqual([32]);
    expect(cfg.inputFormat).toBe('jpg');
    expect(cfg.sourceMimeType).toBe('image/jpeg');
  });

  it('fills svg spec encoding + emit defaults', () => {
    const cfg = parseConfig({ input: 'icon.svg', emit: [{ format: 'svg', inject: 'embed' }] });
    expect(cfg.specs[0]).toMatchObject({ format: 'svg', emit: true, inject: 'embed', encoding: 'base64' });
  });
});

describe('parseConfig — validation', () => {
  const bad = (opts: PluginOptions, re: RegExp) => expect(() => parseConfig(opts)).toThrow(re);

  it('rejects empty input', () => bad({ input: '' }, /non-empty/));
  it('rejects unsupported extension', () => bad({ input: 'icon.bmp' }, /Unsupported input format/));
  it('rejects out-of-range sizes', () => bad({ input: 'icon.svg', sizes: [0, 500] }, /1–256/));
  it('rejects unknown format', () =>
    bad({ input: 'icon.svg', emit: invalid<PluginOptions['emit']>([{ format: 'bmp', sizes: [16] }]) }, /invalid/));
  it('rejects png sizes over 4096', () =>
    bad({ input: 'icon.svg', emit: [{ format: 'png', sizes: invalid<number[]>([5120]) }] }, /1–4096/));
  it('rejects png inject.sizes not a subset', () =>
    bad({ input: 'icon.svg', emit: [{ format: 'png', sizes: [16], inject: { sizes: [64] } }] }, /subset/));
  it('rejects an empty png inject.sizes subset', () =>
    bad({ input: 'icon.svg', emit: [{ format: 'png', sizes: [16], inject: { sizes: [] } }] }, /non-empty subset/));
  it('rejects non-array emit from JS consumers', () =>
    bad({ input: 'icon.svg', emit: invalid<PluginOptions['emit']>(42) }, /Invalid `emit` value/));
  it('rejects invalid svg embed encoding from JS consumers', () =>
    bad(
      {
        input: 'icon.svg',
        emit: invalid<PluginOptions['emit']>([{ format: 'svg', inject: 'embed', encoding: 'raw' }]),
      },
      /encoding/,
    ));
  it('rejects a non-boolean svg inject from JS consumers', () =>
    bad(
      { input: 'icon.svg', emit: invalid<PluginOptions['emit']>([{ format: 'svg', inject: 'yarrr' }]) },
      /inject must be/,
    ));
  it('rejects non-boolean dev flags from JS consumers', () =>
    bad({ input: 'icon.svg', dev: invalid<PluginOptions['dev']>({ enabled: 'false', hmr: 1 }) }, /dev\.(enabled|hmr)/));
  it('rejects a non-object/non-boolean dev value', () =>
    bad({ input: 'icon.svg', dev: invalid<PluginOptions['dev']>(42) }, /`dev` must be a boolean or an object/));
});
