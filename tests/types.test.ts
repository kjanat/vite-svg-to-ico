import { describe, expect, it } from 'bun:test';

import { EMIT_SIZES_FORMATS, INJECT_MODES, SUPPORTED_EXTENSIONS, SVG_EXTENSIONS } from '../src/types.ts';

describe('SUPPORTED_EXTENSIONS', () => {
	it('contains all expected image formats', () => {
		for (const ext of ['.svg', '.svgz', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tiff', '.tif']) {
			expect(SUPPORTED_EXTENSIONS.has(ext)).toBe(true);
		}
	});

	it('does not contain unsupported formats', () => {
		expect(SUPPORTED_EXTENSIONS.has('.bmp')).toBe(false);
		expect(SUPPORTED_EXTENSIONS.has('.ico')).toBe(false);
	});
});

describe('SVG_EXTENSIONS', () => {
	it('contains .svg and .svgz', () => {
		expect(SVG_EXTENSIONS.has('.svg')).toBe(true);
		expect(SVG_EXTENSIONS.has('.svgz')).toBe(true);
	});

	it('does not contain non-SVG', () => {
		expect(SVG_EXTENSIONS.has('.png')).toBe(false);
	});
});

describe('EMIT_SIZES_FORMATS', () => {
	it('contains png, ico, both', () => {
		expect(EMIT_SIZES_FORMATS).toEqual(['png', 'ico', 'both']);
	});
});

describe('INJECT_MODES', () => {
	it('contains minimal, full', () => {
		expect(INJECT_MODES).toEqual(['minimal', 'full']);
	});
});
