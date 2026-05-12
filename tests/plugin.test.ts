import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type { Logger, Plugin, ResolvedConfig } from 'vite';

import svgToIco from '#vite-svg-to-ico';
import type { IconSize, PluginOptions } from '#vite-svg-to-ico';
import { invalid, unwrap } from './_helpers.ts';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/test.svg');

/** Minimal subset of `ResolvedConfig` the plugin's `configResolved` hook reads. */
interface ConfigMock {
	root: string;
	base: string;
	logger: Logger;
}

/**
 * Invoke a plugin's `configResolved` hook directly. Vite's hook signature is
 * `ObjectHook<fn>` (either the function or `{ handler: fn }`), so we narrow
 * both forms here. The `invalid()` cast on the mock is the single boundary
 * between our 3-field test fixture and Vite's full `ResolvedConfig` type.
 */
function callConfigResolved(plugin: Plugin, mock: ConfigMock): void {
	const hook = plugin.configResolved;
	if (!hook) throw new Error('plugin has no configResolved hook');
	const objectHook = typeof hook === 'function' ? hook : hook.handler;
	// Plugin's configResolved doesn't reference `this`, so we drop Rollup's
	// MinimalPluginContextWithoutEnvironment binding via a free-function cast.
	const fn = invalid<(config: ResolvedConfig) => void | Promise<void>>(objectHook);
	fn(invalid<ResolvedConfig>(mock));
}

describe('svgToIco plugin factory', () => {
	it('returns an array of 3 plugins', () => {
		const plugins = svgToIco({ input: FIXTURE });
		expect(plugins).toHaveLength(3);
		expect(unwrap(plugins[0]).name).toBe('svg-to-ico:config');
		expect(unwrap(plugins[1]).name).toBe('svg-to-ico:serve');
		expect(unwrap(plugins[2]).name).toBe('svg-to-ico:build');
	});

	it('uses default options', () => {
		// Should not throw
		const plugins = svgToIco({ input: FIXTURE });
		expect(plugins).toBeDefined();
	});

	it('accepts custom sizes as array', () => {
		const plugins = svgToIco({ input: FIXTURE, sizes: [16, 24, 32, 48, 64] });
		expect(plugins).toHaveLength(3);
	});

	it('accepts single size (not array)', () => {
		const plugins = svgToIco({ input: FIXTURE, sizes: 32 });
		expect(plugins).toHaveLength(3);
	});

	it('accepts all emitSizes formats', () => {
		for (const fmt of ['png', 'ico', 'both', true, false] as const) {
			expect(() => svgToIco({ input: FIXTURE, emit: { sizes: fmt } })).not.toThrow();
		}
	});

	it('accepts all inject modes (legacy)', () => {
		for (const mode of ['minimal', 'full', true, false] as const) {
			expect(() => svgToIco({ input: FIXTURE, emit: { inject: mode } })).not.toThrow();
		}
	});

	it('accepts v3 EmitSpec array', () => {
		expect(() =>
			svgToIco({
				input: FIXTURE,
				emit: [
					{ format: 'ico', sizes: [16, 32, 48], inject: true },
					{ format: 'png', sizes: [192, 512], inject: { sizes: [192] } },
					{ format: 'svg', filename: 'logo.svg', inject: true },
				],
			})
		).not.toThrow();
	});

	it('accepts empty v3 emit array (no extras emitted)', () => {
		expect(() => svgToIco({ input: FIXTURE, emit: [] })).not.toThrow();
	});
});

describe('v3 EmitSpec normalization', () => {
	function captureLogger() {
		const warns: string[] = [];
		const infos: string[] = [];
		return {
			logger: {
				info: (m: string) => infos.push(m),
				warn: (m: string) => warns.push(m),
				warnOnce: (m: string) => warns.push(m),
				error: () => {},
				clearScreen: () => {},
				hasErrorLogged: () => false,
				hasWarned: false,
			},
			warns,
			infos,
		};
	}

	function runConfig(opts: PluginOptions, logger: Logger): Plugin[] {
		const plugins = svgToIco(opts);
		callConfigResolved(unwrap(plugins[0]), { root: '/tmp', base: '/', logger });
		return plugins;
	}

	it('v2 emit shape logs deprecation warning once', () => {
		const { logger, warns } = captureLogger();
		runConfig({ input: FIXTURE, emit: { source: true, inject: 'full' } }, logger);
		expect(warns.filter((w) => w.includes('deprecated'))).toHaveLength(1);
	});

	it('v3 emit array does NOT log deprecation warning', () => {
		const { logger, warns } = captureLogger();
		runConfig({ input: FIXTURE, emit: [{ format: 'ico', sizes: [16] }] }, logger);
		expect(warns.filter((w) => w.includes('deprecated'))).toHaveLength(0);
	});

	it('rejects PngSpec without sizes', () => {
		const { logger } = captureLogger();
		expect(() => runConfig({ input: FIXTURE, emit: [{ format: 'png', sizes: [] }] }, logger)).toThrow(
			'requires `sizes`',
		);
	});

	it('rejects IcoSpec with empty sizes', () => {
		const { logger } = captureLogger();
		expect(() => runConfig({ input: FIXTURE, emit: [{ format: 'ico', sizes: [] }] }, logger)).toThrow(
			'requires `sizes`',
		);
	});

	it('rejects PngSpec inject.sizes not subset of spec.sizes', () => {
		const { logger } = captureLogger();
		expect(() =>
			runConfig(
				{ input: FIXTURE, emit: [{ format: 'png', sizes: [16, 32], inject: { sizes: [64] } }] },
				logger,
			)
		).toThrow('subset');
	});

	it('accepts PngSpec inject.sizes that is a valid subset', () => {
		const { logger } = captureLogger();
		expect(() =>
			runConfig(
				{ input: FIXTURE, emit: [{ format: 'png', sizes: [16, 32, 64], inject: { sizes: [32] } }] },
				logger,
			)
		).not.toThrow();
	});

	it('rejects non-array, non-object emit values from JS consumers', () => {
		// `emit: 42` and `emit: null` fail both type guards and previously
		// silently produced an empty spec list. Should throw with the value.
		expect(() => svgToIco({ input: FIXTURE, emit: invalid<PluginOptions['emit']>(42) })).toThrow(
			'Invalid `emit` value',
		);
		expect(() => svgToIco({ input: FIXTURE, emit: invalid<PluginOptions['emit']>(null) })).toThrow(
			'Invalid `emit` value',
		);
		// BigInt would crash `JSON.stringify` and mask our error; `inspect` handles it.
		expect(() => svgToIco({ input: FIXTURE, emit: invalid<PluginOptions['emit']>(1n) })).toThrow(
			'Invalid `emit` value',
		);
	});

	it('rejects spec sizes out of range', () => {
		const { logger } = captureLogger();
		expect(() =>
			runConfig(
				{ input: FIXTURE, emit: [{ format: 'ico', sizes: invalid<IconSize[]>([0, 500]) }] },
				logger,
			)
		).toThrow('Must be integers 1–256');
	});

	it('rejects unknown format', () => {
		const { logger } = captureLogger();
		expect(() =>
			runConfig(
				{ input: FIXTURE, emit: invalid<PluginOptions['emit']>([{ format: 'bmp', sizes: [16] }]) },
				logger,
			)
		).toThrow('invalid');
	});
});

describe('config plugin validation', () => {
	// configResolved is called by Vite with a resolved config; we simulate it.
	function runConfigResolved(opts: PluginOptions): void {
		const plugins = svgToIco(opts);
		const stubLogger: Logger = {
			info: () => {},
			warn: () => {},
			warnOnce: () => {},
			error: () => {},
			clearScreen: () => {},
			hasErrorLogged: () => false,
			hasWarned: false,
		};
		callConfigResolved(unwrap(plugins[0]), { root: '/tmp', base: '/', logger: stubLogger });
	}

	it('throws on empty input', () => {
		expect(() => runConfigResolved({ input: '' })).toThrow('`input` must be a non-empty string');
	});

	it('throws on unsupported extension', () => {
		expect(() => runConfigResolved({ input: 'icon.bmp' })).toThrow('Unsupported input format');
	});

	it('throws on empty sizes array', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: invalid<IconSize[]>([]) })).toThrow(
			'`sizes` must contain at least one value',
		);
	});

	it('throws on invalid size values', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [0] })).toThrow('Invalid sizes');
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [257] })).toThrow('Invalid sizes');
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [1.5] })).toThrow('Invalid sizes');
	});

	it('throws on invalid emitSizes string', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', emit: invalid<PluginOptions['emit']>({ sizes: 'bad' }) }))
			.toThrow('Invalid emitSizes value');
	});

	it('throws on invalid inject string', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', emit: invalid<PluginOptions['emit']>({ inject: 'bad' }) }))
			.toThrow('Invalid inject value');
	});

	it('passes with valid options', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', sizes: [16, 32, 256] })).not.toThrow();
	});

	it('throws on invalid dev.injection string', () => {
		expect(() => runConfigResolved({ input: 'icon.svg', dev: invalid<PluginOptions['dev']>({ injection: 'bad' }) }))
			.toThrow('Invalid dev.injection value');
	});
});

describe('dev option', () => {
	it('dev: false excludes serve plugin', () => {
		const plugins = svgToIco({ input: FIXTURE, dev: false });
		expect(plugins.some((p) => p.name === 'svg-to-ico:serve')).toBe(false);
		// config and build plugins still present
		expect(plugins.some((p) => p.name === 'svg-to-ico:config')).toBe(true);
		expect(plugins.some((p) => p.name === 'svg-to-ico:build')).toBe(true);
	});

	it('dev: true includes serve plugin (default behavior)', () => {
		const plugins = svgToIco({ input: FIXTURE, dev: true });
		expect(plugins.some((p) => p.name === 'svg-to-ico:serve')).toBe(true);
	});

	it('dev: { injection: "shim" } does not throw', () => {
		expect(() => svgToIco({ input: FIXTURE, dev: { injection: 'shim' } })).not.toThrow();
	});

	it('dev: { hmr: false } does not throw', () => {
		expect(() => svgToIco({ input: FIXTURE, dev: { hmr: false } })).not.toThrow();
	});
});

describe('build plugin: inject-no-op warning', () => {
	function mockLogger() {
		const warns: string[] = [];
		const logger = {
			info: () => {},
			warn: (msg: string) => warns.push(msg),
			warnOnce: (msg: string) => warns.push(msg),
			error: () => {},
			clearScreen: () => {},
			hasErrorLogged: () => false,
			hasWarned: false,
		};
		return { logger, warns };
	}

	// Test-side projection of the build plugin: Vite's Plugin type wraps each
	// hook as `ObjectHook<fn> = fn | { handler: fn }`, but our plugin defines
	// them as plain method shorthands. The cast localizes that knowledge to
	// this single helper.
	interface BuildPluginUnderTest {
		// `this: unknown` accepts both `build.closeBundle()` (this is the plugin
		// object) and `build.closeBundle.call({ environment: ... })` (this is the
		// env mock). The plugin reads `this.environment?.name` internally.
		closeBundle: (this: unknown) => void;
		transformIndexHtml: (html: string) => unknown;
		buildStart: (this: { emitFile: (asset: unknown) => void; error: (msg: string) => never }) => Promise<void>;
	}

	function getBuildPlugin(opts: PluginOptions, logger: Logger): BuildPluginUnderTest {
		const plugins = svgToIco(opts);
		callConfigResolved(unwrap(plugins[0]), { root: '/tmp', base: '/', logger });
		const build = unwrap(plugins.find((p) => p.name === 'svg-to-ico:build'));
		return invalid<BuildPluginUnderTest>(build);
	}

	it('warns when inject is set but transformIndexHtml never fires', () => {
		const { logger, warns } = mockLogger();
		const build = getBuildPlugin({ input: FIXTURE, emit: [{ format: 'ico', inject: true }] }, logger);
		build.closeBundle();
		expect(warns).toHaveLength(1);
		expect(warns[0]).toContain('inject was requested');
		expect(warns[0]).toContain('transformIndexHtml was never called');
	});

	it('does not warn when transformIndexHtml fires', () => {
		const { logger, warns } = mockLogger();
		const build = getBuildPlugin({ input: FIXTURE, emit: [{ format: 'ico', inject: true }] }, logger);
		build.transformIndexHtml('<html><head></head><body></body></html>');
		build.closeBundle();
		expect(warns).toHaveLength(0);
	});

	it('does not warn when inject is disabled', () => {
		const { logger, warns } = mockLogger();
		const build = getBuildPlugin({ input: FIXTURE, emit: [{ format: 'ico', inject: false }] }, logger);
		build.closeBundle();
		expect(warns).toHaveLength(0);
	});

	it('does not warn when called in a non-client Vite environment (e.g. SvelteKit ssr)', () => {
		const { logger, warns } = mockLogger();
		const build = getBuildPlugin({ input: FIXTURE, emit: [{ format: 'ico', inject: true }] }, logger);
		// Simulate Vite 6+ Environment API: closeBundle fires per environment;
		// SSR-side firing must not duplicate the warning.
		build.closeBundle.call({ environment: { name: 'ssr' } });
		expect(warns).toHaveLength(0);
	});

	it('warns once in client env when called for both client and ssr', () => {
		const { logger, warns } = mockLogger();
		const build = getBuildPlugin({ input: FIXTURE, emit: [{ format: 'ico', inject: true }] }, logger);
		build.closeBundle.call({ environment: { name: 'client' } });
		build.closeBundle.call({ environment: { name: 'ssr' } });
		expect(warns).toHaveLength(1);
	});

	it('resets transformIndexHtml-called flag between build cycles (watch mode)', async () => {
		const { logger, warns } = mockLogger();
		const build = getBuildPlugin({ input: FIXTURE, emit: [{ format: 'ico', inject: true }] }, logger);

		// Cycle 1: transformIndexHtml fires (vanilla) → no warning.
		await build.buildStart.call({
			emitFile: () => {},
			error: (m: string) => {
				throw new Error(m);
			},
		});
		build.transformIndexHtml('<html><head></head></html>');
		build.closeBundle();
		expect(warns).toHaveLength(0);

		// Cycle 2: hook doesn't fire (framework swap mid-watch). Flag must have reset.
		await build.buildStart.call({
			emitFile: () => {},
			error: (m: string) => {
				throw new Error(m);
			},
		});
		build.closeBundle();
		expect(warns).toHaveLength(1);
		expect(warns[0]).toContain('transformIndexHtml was never called');
	});
});
