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
});
