import { describe, expect, it } from 'bun:test';

import { toDataUri } from '#dataUri';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>';

describe('toDataUri — base64', () => {
  it('encodes bytes as a base64 data URI with the given mime', () => {
    const uri = toDataUri(Buffer.from('hello'), 'image/x-icon', 'base64');
    expect(uri).toBe(`data:image/x-icon;base64,${Buffer.from('hello').toString('base64')}`);
  });

  it('round-trips binary bytes losslessly', () => {
    const bytes = Buffer.from([0x00, 0x01, 0xff, 0x7f, 0x80]);
    const uri = toDataUri(bytes, 'image/png', 'base64');
    const b64 = uri.slice('data:image/png;base64,'.length);
    expect(Buffer.from(b64, 'base64').equals(bytes)).toBe(true);
  });

  it('uses base64 for SVG too when asked', () => {
    const uri = toDataUri(Buffer.from(SVG), 'image/svg+xml', 'base64');
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});

describe('toDataUri — utf8 (SVG)', () => {
  it('produces a comma-separated (non-base64) svg+xml URI', () => {
    const uri = toDataUri(Buffer.from(SVG), 'image/svg+xml', 'utf8');
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(uri).not.toContain(';base64,');
  });

  it('escapes the characters that would break the URI or HTML attribute', () => {
    const uri = toDataUri(Buffer.from(SVG), 'image/svg+xml', 'utf8');
    const body = uri.slice('data:image/svg+xml,'.length);
    // `<`, `>`, `#`, `%` must be percent-encoded; raw `"` must not survive.
    expect(body).not.toContain('<');
    expect(body).not.toContain('>');
    expect(body).not.toContain('"');
    expect(body).toContain('%3C'); // <
    expect(body).toContain('%3E'); // >
  });

  it('percent-encodes & so the URI is safe in an HTML attribute', () => {
    const uri = toDataUri(Buffer.from('<svg><a href="x?a=1&b=2"/></svg>'), 'image/svg+xml', 'utf8');
    expect(uri).toContain('%26');
    expect(uri.slice('data:image/svg+xml,'.length)).not.toContain('&');
  });

  it('percent-encodes double quotes instead of swapping them, keeping bytes intact', () => {
    const uri = toDataUri(Buffer.from(SVG), 'image/svg+xml', 'utf8');
    // `"` → `%22`, never `'` (a swap would mutate CDATA/CSS/script content).
    expect(uri).toContain('xmlns=%22http://www.w3.org/2000/svg%22');
    expect(uri).not.toContain("'");
  });

  it('preserves the SVG byte-for-byte, including CDATA and significant whitespace', () => {
    const svg =
      '<svg><style><![CDATA[ .a::after { content: "  x  " } ]]></style><text xml:space="preserve">a    b</text></svg>';
    const uri = toDataUri(Buffer.from(svg), 'image/svg+xml', 'utf8');
    const decoded = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
    expect(decoded).toBe(svg);
  });

  it('utf8 is smaller than base64 for typical SVG', () => {
    const utf8 = toDataUri(Buffer.from(SVG), 'image/svg+xml', 'utf8');
    const b64 = toDataUri(Buffer.from(SVG), 'image/svg+xml', 'base64');
    expect(utf8.length).toBeLessThan(b64.length);
  });
});
