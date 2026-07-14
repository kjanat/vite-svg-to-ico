import { describe, expect, it } from 'bun:test';

import { buildFaviconTags, cacheBust } from '#faviconTags';
import { resolveSpecs } from '#resolveSpecs';
import { unwrap } from '#testHelpers';

const svgCtx = { inputFormat: 'svg' };

describe('cacheBust', () => {
	it('appends the version query to a plain href', () => {
		expect(cacheBust('/favicon.svg', 'abc')).toBe('/favicon.svg?v=abc');
	});

	it('uses & when a query already exists', () => {
		expect(cacheBust('/favicon.svg?x=1', 'abc')).toBe('/favicon.svg?x=1&v=abc');
	});

	it('inserts the version before a #fragment so the bust still matches', () => {
		expect(cacheBust('/favicon.svg#icon', 'abc')).toBe('/favicon.svg?v=abc#icon');
		expect(cacheBust('/favicon.svg?x=1#icon', 'abc')).toBe('/favicon.svg?x=1&v=abc#icon');
	});

	it('leaves data: URIs untouched', () => {
		expect(cacheBust('data:image/svg+xml,STUB', 'abc')).toBe('data:image/svg+xml,STUB');
	});
});

describe('buildFaviconTags', () => {
	it('builds a base-prefixed file href', async () => {
		const { injections } = resolveSpecs([{ format: 'ico', sizes: [16, 32], inject: true }], svgCtx);
		const [tag] = await buildFaviconTags(injections, { base: '/app/' });
		const attrs = unwrap(unwrap(tag).attrs);
		expect(attrs['href']).toBe('/app/favicon.ico');
		expect(attrs['type']).toBe('image/x-icon');
		expect(attrs['sizes']).toBe('16x16 32x32');
	});

	it('cache-busts file hrefs when cacheId is set', async () => {
		const { injections } = resolveSpecs([{ format: 'ico', sizes: [16], inject: true }], svgCtx);
		const [tag] = await buildFaviconTags(injections, { cacheId: 'abc' });
		expect(unwrap(unwrap(tag).attrs)['href']).toBe('/favicon.ico?v=abc');
	});

	it('resolves embed-kind injections through ctx.embed and never cache-busts them', async () => {
		const { injections } = resolveSpecs([{ format: 'svg', inject: 'embed' }], svgCtx);
		const [tag] = await buildFaviconTags(injections, {
			cacheId: 'abc',
			embed: () => 'data:image/svg+xml,STUB',
		});
		expect(unwrap(unwrap(tag).attrs)['href']).toBe('data:image/svg+xml,STUB');
	});

	it('lets ctx.embed inline a file-kind injection (CLI path)', async () => {
		const { injections } = resolveSpecs([{ format: 'ico', sizes: [16], inject: true }], svgCtx);
		const [tag] = await buildFaviconTags(injections, {
			embed: (inj) => (inj.href.kind === 'file' ? 'data:image/x-icon;base64,AAA' : undefined),
		});
		expect(unwrap(unwrap(tag).attrs)['href']).toBe('data:image/x-icon;base64,AAA');
	});

	it('throws if an embed-kind injection has no resolver', async () => {
		const { injections } = resolveSpecs([{ format: 'svg', inject: 'embed' }], svgCtx);
		await expect(buildFaviconTags(injections, {})).rejects.toThrow(/without a resolver/);
	});
});
