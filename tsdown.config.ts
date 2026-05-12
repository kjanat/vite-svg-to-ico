import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts', 'src/cli.ts'],
	dts: { entry: 'src/index.ts' },
	exports: {
		bin: './src/cli.ts',
		customExports(exports) {
			const entry = exports['.'];
			if (typeof entry === 'string') {
				exports['.'] = { bun: './src/index.ts', default: entry };
			}
			// CLI is consumed via the `bin` field, not as a runtime import.
			delete exports['./cli'];
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
