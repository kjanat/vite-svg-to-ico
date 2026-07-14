import { describe, expect, it } from 'bun:test';

import { resolveSpecs } from '#resolveSpecs';
import { unwrap } from '#testHelpers';
import type { EmitSpec } from '#types';

const svgCtx = { inputFormat: 'svg' };

/** Resolve a single spec against an SVG input. */
function one(spec: EmitSpec) {
	return resolveSpecs([spec], svgCtx);
}

describe('resolveSpecs', () => {
	describe('emit gate', () => {
		it('emits the file by default (emit omitted)', () => {
			const { files } = one({ format: 'ico', sizes: [16] });
			expect(files.map((f) => f.filename)).toEqual(['favicon.ico']);
		});

		it('skips the file when emit: false', () => {
			const { files } = one({ format: 'ico', sizes: [16], emit: false, inject: 'embed' });
			expect(files).toHaveLength(0);
		});

		it('emits and embeds together (emit:true + inject:embed)', () => {
			const { files, injections } = one({ format: 'svg', emit: true, inject: 'embed' });
			expect(files).toHaveLength(1);
			expect(unwrap(injections[0]).href.kind).toBe('embed');
		});
	});

	describe('embed hrefs', () => {
		it('ico inject:embed → base64 embed href carrying the ico source', () => {
			const { injections } = one({ format: 'ico', sizes: [16, 32], inject: 'embed' });
			const href = unwrap(injections[0]).href;
			expect(href.kind).toBe('embed');
			if (href.kind !== 'embed') throw new Error('expected embed href');
			expect(href.encoding).toBe('base64');
			expect(href.source.kind).toBe('combined-ico');
			if (href.source.kind !== 'combined-ico') throw new Error('expected combined-ico');
			expect(href.source.sizes.map(Number)).toEqual([16, 32]);
		});

		it('ico inject:true → file href (unchanged behavior)', () => {
			const { injections } = one({ format: 'ico', sizes: [16], inject: true });
			expect(unwrap(injections[0]).href).toEqual({ kind: 'file', filename: 'favicon.ico' });
		});

		it('svg inject:embed defaults to base64 encoding', () => {
			const { injections } = one({ format: 'svg', inject: 'embed' });
			const href = unwrap(injections[0]).href;
			expect(href).toEqual({ kind: 'embed', source: { kind: 'source-copy' }, encoding: 'base64' });
		});

		it('svg inject:embed honors encoding: utf8', () => {
			const { injections } = one({ format: 'svg', inject: 'embed', encoding: 'utf8' });
			const href = unwrap(injections[0]).href;
			expect(href).toMatchObject({ kind: 'embed', encoding: 'utf8' });
		});
	});

	describe('png embed', () => {
		it("inject:'embed' embeds every size", () => {
			const { injections } = one({ format: 'png', sizes: [16, 32], inject: 'embed' });
			expect(injections).toHaveLength(2);
			for (const inj of injections) expect(inj.href.kind).toBe('embed');
		});

		it('{ sizes, embed:true } embeds only the listed subset', () => {
			const { injections } = one({ format: 'png', sizes: [16, 32], inject: { sizes: [16], embed: true } });
			expect(injections).toHaveLength(1);
			expect(unwrap(injections[0]).sizes).toBe('16x16');
			expect(unwrap(injections[0]).href.kind).toBe('embed');
		});

		it('{ sizes } stays a URL link (no embed)', () => {
			const { injections } = one({ format: 'png', sizes: [16, 32], inject: { sizes: [16] } });
			expect(unwrap(injections[0]).href.kind).toBe('file');
		});
	});

	describe('warnings', () => {
		it('warns when emit:false and nothing is injected', () => {
			const { warnings, files, injections } = one({ format: 'ico', sizes: [16], emit: false });
			expect(files).toHaveLength(0);
			expect(injections).toHaveLength(0);
			expect(warnings).toHaveLength(1);
			expect(unwrap(warnings[0])).toContain('no output');
		});

		it('warns when emit:false but inject links a (missing) file', () => {
			const { warnings } = one({ format: 'svg', emit: false, inject: true });
			expect(unwrap(warnings[0])).toContain("won't exist");
		});

		it('does not warn for the intended embed-only case', () => {
			const { warnings } = one({ format: 'svg', emit: false, inject: 'embed' });
			expect(warnings).toHaveLength(0);
		});
	});
});
