import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { inputBasename, inputExtname, isHttpUrl, loadInputBytes, normalizeInput } from '#internals/load-input.ts';

const FIXTURE_PATH = resolve(import.meta.dirname, 'fixtures/test.svg');
const FIXTURE_URL = pathToFileURL(FIXTURE_PATH);

describe('normalizeInput', () => {
  it('passes filesystem path strings through unchanged', () => {
    expect(normalizeInput('/abs/icon.svg')).toBe('/abs/icon.svg');
    expect(normalizeInput('./rel/icon.svg')).toBe('./rel/icon.svg');
  });

  it('converts file:// URL strings to filesystem paths', () => {
    expect(normalizeInput(FIXTURE_URL.toString())).toBe(FIXTURE_PATH);
  });

  it('converts file:// URL instances to filesystem paths', () => {
    expect(normalizeInput(FIXTURE_URL)).toBe(FIXTURE_PATH);
  });

  it('returns http(s) URL instances as their href string', () => {
    const u = new URL('https://example.test/icon.svg?v=1');
    expect(normalizeInput(u)).toBe('https://example.test/icon.svg?v=1');
  });

  it('passes http(s) URL strings through unchanged', () => {
    expect(normalizeInput('https://example.test/icon.svg')).toBe('https://example.test/icon.svg');
  });

  it('throws TypeError on URL instances with unsupported protocols', () => {
    const ftp = new URL('ftp://example.test/icon.svg');
    expect(() => normalizeInput(ftp)).toThrow(TypeError);
  });
});

describe('isHttpUrl', () => {
  it('detects http and https URLs (string and URL instance)', () => {
    expect(isHttpUrl('https://example.test/x.svg')).toBe(true);
    expect(isHttpUrl('http://example.test/x.svg')).toBe(true);
    expect(isHttpUrl(new URL('https://example.test/x.svg'))).toBe(true);
  });

  it('returns false for filesystem paths and file:// URLs', () => {
    expect(isHttpUrl('/abs/icon.svg')).toBe(false);
    expect(isHttpUrl(FIXTURE_URL)).toBe(false);
    expect(isHttpUrl(FIXTURE_URL.toString())).toBe(false);
  });
});

describe('inputBasename / inputExtname', () => {
  it('extracts basename from URL pathname (query string stripped)', () => {
    expect(inputBasename('https://example.test/path/icon.svg?v=2')).toBe('icon.svg');
    expect(inputExtname('https://example.test/path/icon.svg?v=2')).toBe('.svg');
  });

  it('handles URL instances', () => {
    expect(inputBasename(new URL('https://example.test/a/b/logo.png'))).toBe('logo.png');
    expect(inputExtname(new URL('https://example.test/a/b/logo.png'))).toBe('.png');
  });

  it('handles file:// inputs by treating them as paths', () => {
    expect(inputBasename(FIXTURE_URL)).toBe('test.svg');
    expect(inputExtname(FIXTURE_URL)).toBe('.svg');
  });

  it("falls back to 'favicon' for URLs with no path segment", () => {
    expect(inputBasename('https://example.test')).toBe('favicon');
  });
});

describe('loadInputBytes', () => {
  it('reads bytes from a filesystem path', async () => {
    const bytes = await loadInputBytes(FIXTURE_PATH);
    const ref = await readFile(FIXTURE_PATH);
    expect(bytes.equals(ref)).toBe(true);
  });

  it('reads bytes from a file:// URL instance', async () => {
    const bytes = await loadInputBytes(FIXTURE_URL);
    const ref = await readFile(FIXTURE_PATH);
    expect(bytes.equals(ref)).toBe(true);
  });

  it('reads bytes from a file:// URL string', async () => {
    const bytes = await loadInputBytes(FIXTURE_URL.toString());
    const ref = await readFile(FIXTURE_PATH);
    expect(bytes.equals(ref)).toBe(true);
  });
});
