import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts', 'src/cli.ts'],
	dts: { entry: 'src/index.ts' },
	exports: {
		bin: { 'svg-to-ico': 'src/cli.ts' },
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
	onSuccess: 'bunx --bun npm pkg fix',
	unbundle: true,
	minify: 'dce-only',
	publint: true,
	attw: {
		ignoreRules: ['cjs-resolves-to-esm', 'no-resolution'],
	},
});
