import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: 'src/index.ts',
	dts: true,
	exports: {
		customExports(exports) {
			const entry = exports['.'];
			if (typeof entry === 'string') {
				exports['.'] = { bun: './src/index.ts', default: entry };
			}
			return exports;
		},
	},
	clean: true,
	target: 'esnext',
	unused: true,
	onSuccess: 'bun fmt package.json',
	unbundle: true,
	minify: 'dce-only',
	publint: true,
	attw: {
		ignoreRules: ['cjs-resolves-to-esm', 'no-resolution'],
	},
});
