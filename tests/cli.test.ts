import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { generate, inject } from '#internals/cli.ts';
import { runCommand } from '@kjanat/dreamcli/testkit';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/test.svg');

async function setupTmp(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'vite-svg-to-ico-cli-'));
}

describe('CLI: generate', () => {
	it('writes a multi-size favicon.ico to the out dir', async () => {
		const dir = await setupTmp();
		const result = await runCommand(generate, [FIXTURE, '--out-dir', dir, '--sizes', '16,32']);
		expect(result.exitCode).toBe(0);

		const stats = await readFile(join(dir, 'favicon.ico'));
		expect(stats.byteLength).toBeGreaterThan(0);
		// ICO magic header: reserved (00 00) + type (01 00) + count (02 00 for 2 sizes)
		expect(stats[0]).toBe(0);
		expect(stats[2]).toBe(1);
		expect(stats[4]).toBe(2);
	});

	it('emits source file when --emit-source is set', async () => {
		const dir = await setupTmp();
		const result = await runCommand(generate, [FIXTURE, '--out-dir', dir, '--emit-source']);
		expect(result.exitCode).toBe(0);

		const source = await readFile(join(dir, 'test.svg'), 'utf8');
		expect(source).toContain('<svg');
	});

	it('emits per-size PNGs when --emit-sizes png is set', async () => {
		const dir = await setupTmp();
		const result = await runCommand(generate, /* dprint-ignore */ [
			FIXTURE,
			'--out-dir', dir,
			'--sizes', '16,32',
			'--emit-sizes', 'png',
		]);
		expect(result.exitCode).toBe(0);

		const png16 = await readFile(join(dir, 'favicon-16x16.png'));
		const png32 = await readFile(join(dir, 'favicon-32x32.png'));
		// PNG magic: 89 50 4E 47
		expect(png16[0]).toBe(0x89);
		expect(png16[1]).toBe(0x50);
		expect(png32[0]).toBe(0x89);
	});

	it('rejects invalid sizes', async () => {
		const dir = await setupTmp();
		const result = await runCommand(generate, [FIXTURE, '--out-dir', dir, '--sizes', '0,500']);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.join('')).toContain('Invalid size');
	});
});

describe('CLI: inject', () => {
	const HTML = '<html><head><title>x</title><link rel="icon" href="/old.ico"></head><body></body></html>';

	it('rewrites a single HTML file with minimal mode', async () => {
		const dir = await setupTmp();
		const file = join(dir, 'index.html');
		await writeFile(file, HTML);

		const result = await runCommand(inject, [file, '--sizes', '16,32']);
		expect(result.exitCode).toBe(0);

		const updated = await readFile(file, 'utf8');
		expect(updated).toContain('rel="icon"');
		expect(updated).toContain('href="/favicon.ico"');
		expect(updated).toContain('sizes="16x16 32x32"');
		expect(updated).not.toContain('/old.ico');
	});

	it('preserves apple-touch-icon', async () => {
		const dir = await setupTmp();
		const file = join(dir, 'index.html');
		await writeFile(
			file,
			'<html><head><link rel="icon" href="/old.ico"><link rel="apple-touch-icon" href="/apple.png"></head></html>',
		);

		await runCommand(inject, [file]);
		const updated = await readFile(file, 'utf8');
		expect(updated).toContain('apple-touch-icon');
		expect(updated).not.toContain('/old.ico');
	});

	it('handles multiple files via variadic arg', async () => {
		const dir = await setupTmp();
		const a = join(dir, 'a.html');
		const b = join(dir, 'b.html');
		await writeFile(a, '<head></head>');
		await writeFile(b, '<head></head>');

		const result = await runCommand(inject, [a, b]);
		expect(result.exitCode).toBe(0);
		expect(await readFile(a, 'utf8')).toContain('/favicon.ico');
		expect(await readFile(b, 'utf8')).toContain('/favicon.ico');
	});

	it('honors --base', async () => {
		const dir = await setupTmp();
		const file = join(dir, 'index.html');
		await writeFile(file, '<head></head>');

		await runCommand(inject, [file, '--base', '/app/']);
		const updated = await readFile(file, 'utf8');
		expect(updated).toContain('href="/app/favicon.ico"');
	});

	it('emits SVG link when --source is provided', async () => {
		const dir = await setupTmp();
		const file = join(dir, 'index.html');
		await writeFile(file, '<head></head>');

		await runCommand(inject, [file, '--source', 'favicon.svg']);
		const updated = await readFile(file, 'utf8');
		expect(updated).toContain('type="image/svg+xml"');
		expect(updated).toContain('href="/favicon.svg"');
	});

	it('reports missing files but does not fail the run', async () => {
		const dir = await setupTmp();
		const present = join(dir, 'present.html');
		await writeFile(present, '<head></head>');

		const result = await runCommand(inject, [present, join(dir, 'nope.html')]);
		expect(result.exitCode).toBe(0);
		const all = [...result.stdout, ...result.stderr].join('\n');
		expect(all).toContain('file not found');
		// the present one still got rewritten
		expect(await readFile(present, 'utf8')).toContain('/favicon.ico');
	});
});
