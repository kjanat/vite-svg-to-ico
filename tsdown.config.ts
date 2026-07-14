import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { sortPackageJson } from 'sort-package-json';
import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts', 'src/cli.ts'],
	dts: { entry: 'src/index.ts' },
	/** Keep vite as a `import type` reference in `.d.mts`.
	 * Consumers resolve it via their own install. Without this the dts plugin walks into vite's
	 * type chain and chokes on transitive postcss/lightningcss types. */
	deps: {
		neverBundle: ['vite'],
	},
	exports: {
		bin: { 'svg-to-ico': 'src/cli.ts' },
		exclude: ['cli'],
		customExports(exports) {
			exports['.'] = { types: exports['.'].replace(/\.([mc]?)js$/, '.d.$1ts'), default: exports['.'] };
			return exports;
		},
	},
	clean: true,
	target: 'esnext',
	unbundle: true,
	minify: 'dce-only',
	unused: 'ci-only',
	publint: 'ci-only',
	/* `@arethetypeswrong/core@0.18.2` breaks on tarball extraction when `fflate@0.8.3` is installed (upstream issue #258).
   * Pinned to `fflate@0.8.2` via root `overrides` until attw's untar handling is fixed. */
	attw: { profile: 'esm-only', enabled: 'ci-only' },
	hooks: {
		'build:done': async () => {
			try {
				const filePath = new URL('./package.json', import.meta.url);
				const contents = await readFile(filePath, { encoding: 'utf8' });
				await writeFile('package.json', sortPackageJson(contents), { encoding: 'utf8' });
				execFile('npm', ['pkg', 'fix']);
			} catch (err) {
				console.error('Failed to sort package.json:', err);
			}
		},
	},
});
