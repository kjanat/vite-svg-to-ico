import { describe, expect, it } from 'bun:test';

import { buildFaviconTags, INJECT_ICON_LINK_RE, injectTagsIntoHtml, renderTag } from '$/html.ts';

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
		expect(tags[0]!.attrs!['type']).toBe('image/x-icon');
		expect(tags[0]!.attrs!['href']).toBe('/favicon.ico');
		expect(tags[0]!.attrs!['sizes']).toBe('16x16 32x32');
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
		expect(tags[1]!.attrs!['type']).toBe('image/svg+xml');
		expect(tags[1]!.attrs!['href']).toBe('/icon.svg');
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
		expect(tags[1]!.attrs!['sizes']).toBe('16x16');
		expect(tags[2]!.attrs!['sizes']).toBe('32x32');
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

describe('INJECT_ICON_LINK_RE', () => {
	it('matches <link rel="icon" ...>', () => {
		expect('<link rel="icon" href="/favicon.ico">').toMatch(INJECT_ICON_LINK_RE);
	});

	it('matches <link rel="shortcut icon" ...>', () => {
		// Reset lastIndex since it's a global regex
		INJECT_ICON_LINK_RE.lastIndex = 0;
		expect('<link rel="shortcut icon" href="/favicon.ico">').toMatch(INJECT_ICON_LINK_RE);
	});

	it('matches with single quotes', () => {
		INJECT_ICON_LINK_RE.lastIndex = 0;
		expect("<link rel='icon' href='/favicon.ico'>").toMatch(INJECT_ICON_LINK_RE);
	});

	it('does NOT match apple-touch-icon', () => {
		INJECT_ICON_LINK_RE.lastIndex = 0;
		expect('<link rel="apple-touch-icon" href="/apple.png">').not.toMatch(INJECT_ICON_LINK_RE);
	});

	it('does NOT match stylesheet', () => {
		INJECT_ICON_LINK_RE.lastIndex = 0;
		expect('<link rel="stylesheet" href="/style.css">').not.toMatch(INJECT_ICON_LINK_RE);
	});
});

describe('renderTag', () => {
	it('renders a void link tag with attributes', () => {
		expect(renderTag({
			tag: 'link',
			attrs: { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
		})).toBe('<link rel="icon" type="image/x-icon" href="/favicon.ico">');
	});

	it('escapes double quotes in attribute values', () => {
		expect(renderTag({
			tag: 'link',
			attrs: { rel: 'icon', href: '/path"with"quotes.ico' },
		})).toBe('<link rel="icon" href="/path&quot;with&quot;quotes.ico">');
	});

	it('skips false/undefined/null attribute values', () => {
		expect(renderTag({
			tag: 'link',
			attrs: { rel: 'icon', href: '/favicon.ico', disabled: false, foo: undefined as any },
		})).toBe('<link rel="icon" href="/favicon.ico">');
	});

	it('renders boolean true attribute as bare name', () => {
		expect(renderTag({
			tag: 'script',
			attrs: { async: true, src: '/x.js' },
			children: '',
		})).toBe('<script async src="/x.js"></script>');
	});

	it('renders children for non-void tags', () => {
		expect(renderTag({
			tag: 'script',
			attrs: { type: 'module' },
			children: 'console.log(1)',
		})).toBe('<script type="module">console.log(1)</script>');
	});
});

describe('injectTagsIntoHtml', () => {
	const FAVICON_TAG = {
		tag: 'link',
		attrs: { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
	} as const;

	it('inserts tags before </head>', () => {
		const html = '<html><head><title>x</title></head><body></body></html>';
		const out = injectTagsIntoHtml(html, [FAVICON_TAG]);
		expect(out).toContain('<link rel="icon" type="image/x-icon" href="/favicon.ico">');
		expect(out.indexOf('<link rel="icon"')).toBeLessThan(out.indexOf('</head>'));
	});

	it('strips existing icon links but preserves apple-touch-icon', () => {
		const html =
			'<html><head><link rel="icon" href="/old.ico"><link rel="apple-touch-icon" href="/apple.png"></head><body></body></html>';
		const out = injectTagsIntoHtml(html, [FAVICON_TAG]);
		expect(out).not.toContain('/old.ico');
		expect(out).toContain('apple-touch-icon');
		expect(out).toContain('/favicon.ico');
	});

	it('appends tags when no </head> is present', () => {
		const html = '<div>fragment</div>';
		const out = injectTagsIntoHtml(html, [FAVICON_TAG]);
		expect(out).toContain('/favicon.ico');
		expect(out.startsWith('<div>fragment</div>')).toBe(true);
	});
});
