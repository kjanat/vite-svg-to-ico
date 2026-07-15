import exec from 'node:child_process';
import fs from 'node:fs/promises';
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
	clean: true,
	target: 'esnext',
	unbundle: true,
	minify: 'dce-only',
	unused: 'ci-only',
	publint: 'ci-only',
	/* `@arethetypeswrong/core@0.18.2` breaks on tarball extraction when `fflate@0.8.3` is installed (upstream issue #258).
   * Pinned to `fflate@0.8.2` via root `overrides` until attw's untar handling is fixed. */
	attw: { profile: 'esm-only', enabled: 'ci-only' },
	exports: {
		bin: { 'svg-to-ico': 'src/cli.ts' },
		exclude: ['cli'],
		async customExports(exports) {
			for (const [key, value] of Object.entries(exports)) {
				if (typeof value !== 'string') continue;
				const types = value.replace(/\.([cm]?)js$/, '.d.$1ts');
				if (types === value || !(fs.access(types))) continue;
				exports[key] = { types, default: value };
			}
			return exports;
		},
	},
	hooks: {
		'build:done': async () => {
			try {
				const filePath = new URL('./package.json', import.meta.url);
				const contents = await fs.readFile(filePath, { encoding: 'utf8' });
				await fs.writeFile('package.json', sortPackageJson(contents), { encoding: 'utf8' });
				exec.execFile('npm', ['pkg', 'fix']);
				exec.execFile('dprint', ['fmt', 'package.json']);
			} catch (err) {
				console.error('Failed to sort package.json:', err);
			}
		},
	},
});
