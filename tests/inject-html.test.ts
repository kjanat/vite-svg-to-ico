import { describe, expect, it } from 'bun:test';

import { INJECT_ICON_LINK_RE, injectTagsIntoHtml, renderTag } from '#injectHtml';

describe('INJECT_ICON_LINK_RE', () => {
	it('matches <link rel="icon" ...>', () => {
		expect('<link rel="icon" href="/favicon.ico">').toMatch(INJECT_ICON_LINK_RE);
	});

	it('matches <link rel="shortcut icon" ...>', () => {
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
	it('renders attrs and escapes double quotes', () => {
		const html = renderTag({ tag: 'link', attrs: { rel: 'icon', href: 'a"b' }, injectTo: 'head' });
		expect(html).toBe('<link rel="icon" href="a&quot;b">');
	});

	it('omits false/undefined/null attrs and renders boolean-true as bare', () => {
		const html = renderTag({ tag: 'script', attrs: { defer: true, nomodule: false }, injectTo: 'head' });
		expect(html).toBe('<script defer>');
	});
});

describe('injectTagsIntoHtml', () => {
	const ico = { tag: 'link' as const, attrs: { rel: 'icon', href: '/favicon.ico' }, injectTo: 'head' as const };

	it('strips existing icon links and splices before </head>, preserving apple-touch-icon', () => {
		const html =
			'<html><head><link rel="icon" href="/old.ico"><link rel="apple-touch-icon" href="/a.png"></head></html>';
		const out = injectTagsIntoHtml(html, [ico]);
		expect(out).toContain('apple-touch-icon');
		expect(out).not.toContain('/old.ico');
		expect(out).toContain('href="/favicon.ico"');
		expect(out.indexOf('href="/favicon.ico"')).toBeLessThan(out.indexOf('</head>'));
	});

	it('appends at the end when no </head> is present', () => {
		const out = injectTagsIntoHtml('<body>x</body>', [ico]);
		expect(out).toContain('<body>x</body>');
		expect(out).toContain('href="/favicon.ico"');
	});

	describe('indentation', () => {
		const png = { tag: 'link' as const, attrs: { rel: 'icon', href: '/f.png' }, injectTo: 'head' as const };

		it('copies the indentation of the last populated line in <head>', () => {
			const html = '<html>\n  <head>\n    <title>x</title>\n  </head>\n</html>';
			expect(injectTagsIntoHtml(html, [ico])).toBe(
				'<html>\n  <head>\n    <title>x</title>\n    <link rel="icon" href="/favicon.ico">\n  </head>\n</html>',
			);
		});

		it('uses tabs in a tab-indented document', () => {
			const html = '<html>\n\t<head>\n\t\t<title>x</title>\n\t</head>\n</html>';
			const out = injectTagsIntoHtml(html, [ico, png]);
			expect(out).toContain(
				'\n\t\t<link rel="icon" href="/favicon.ico">\n\t\t<link rel="icon" href="/f.png">\n\t</head>',
			);
			expect(out).not.toContain('    <link');
		});

		it('matches a four-space document instead of imposing its own width', () => {
			const html = '<html>\n    <head>\n        <title>x</title>\n    </head>\n</html>';
			expect(injectTagsIntoHtml(html, [ico])).toContain('\n        <link rel="icon" href="/favicon.ico">\n    </head>');
		});

		it('adds no whitespace when </head> does not start its own line', () => {
			const html = '<html><head><title>x</title></head><body></body></html>';
			expect(injectTagsIntoHtml(html, [ico, png])).toBe(
				'<html><head><title>x</title><link rel="icon" href="/favicon.ico"><link rel="icon" href="/f.png"></head><body></body></html>',
			);
		});

		it('steps in from the closing tag when <head> is empty', () => {
			const html = '<html>\n  <head>\n  </head>\n</html>';
			expect(injectTagsIntoHtml(html, [ico])).toBe(
				'<html>\n  <head>\n    <link rel="icon" href="/favicon.ico">\n  </head>\n</html>',
			);
		});

		it('scans the whole document when there is no opening <head> tag', () => {
			const html = '<html>\n  <title>x</title>\n</head>\n</html>';
			expect(injectTagsIntoHtml(html, [ico])).toBe(
				'<html>\n  <title>x</title>\n  <link rel="icon" href="/favicon.ico">\n</head>\n</html>',
			);
		});

		it('preserves CRLF line endings', () => {
			const html = '<html>\r\n  <head>\r\n    <title>x</title>\r\n  </head>\r\n</html>';
			const out = injectTagsIntoHtml(html, [ico]);
			expect(out).toContain('\r\n    <link rel="icon" href="/favicon.ico">\r\n  </head>');
			expect(out).not.toMatch(/[^\r]\n/);
		});
	});
});
