import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import svgToIco from '$/index.ts';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/test.svg');

describe('svgToIco plugin factory', () => {
	it('returns an array of 3 plugins', () => {
		const plugins = svgToIco({ input: FIXTURE });
		expect(plugins).toHaveLength(3);
		expect(plugins[0]!.name).toBe('svg-to-ico:config');
		expect(plugins[1]!.name).toBe('svg-to-ico:serve');
		expect(plugins[2]!.name).toBe('svg-to-ico:build');
	});

	it('uses default options', () => {
		// Should not throw
		const plugins = svgToIco({ input: FIXTURE });
		expect(plugins).toBeDefined();
	});

	it('accepts custom sizes as array', () => {
		const plugins = svgToIco({ input: FIXTURE, sizes: [16, 24, 32, 48, 64] });
		expect(plugins).toHaveLength(3);
	});

	it('accepts single size (not array)', () => {
		const plugins = svgToIco({ input: FIXTURE, sizes: 32 });
		expect(plugins).toHaveLength(3);
	});

	it('accepts all emitSizes formats', () => {
		for (const fmt of ['png', 'ico', 'both', true, false] as const) {
			expect(() => svgToIco({ input: FIXTURE, emitSizes: fmt })).not.toThrow();
		}
	});

	it('accepts all inject modes', () => {
		for (const mode of ['minimal', 'full', true, false] as const) {
			expect(() => svgToIco({ input: FIXTURE, inject: mode })).not.toThrow();
		}
	});
});

describe('config plugin validation', () => {
	// configResolved is called by Vite with a resolved config; we simulate it
	function runConfigResolved(opts: Parameters<typeof svgToIco>[0]) {
		const plugins = svgToIco(opts);
		const configPlugin = plugins[0];
		const hook = (configPlugin as any).configResolved;
		hook({ root: '/tmp', logger: { info: () => {} } });
	}

	it('throws on empty input', () => {
		expect(() => runConfigResolved({ input: '' })).toThrow('`input` must be a non-empty string');
	});

	it('throws on unsupported extension', () => {
		expect(() => runConfigResolved({ input: 'icon.bmp' })).toThrow('Unsupported input format');
	});

	it('throws on empty sizes array', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [] as any })).toThrow(
			'`sizes` must contain at least one value',
		);
	});

	it('throws on invalid size values', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [0] })).toThrow('Invalid sizes');
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [257] })).toThrow('Invalid sizes');
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [1.5] })).toThrow('Invalid sizes');
	});

	it('throws on invalid emitSizes string', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', emitSizes: 'bad' as any })).toThrow(
			'Invalid emitSizes value',
		);
	});

	it('throws on invalid inject string', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', inject: 'bad' as any })).toThrow(
			'Invalid inject value',
		);
	});

	it('passes with valid options', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [16, 32, 256] })).not.toThrow();
	});
});
