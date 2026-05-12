import { basename, parse } from 'node:path';
import { isLegacyEmit } from './types.ts';
import type { EmitSpec, IconSize, IcoSpec, NormalizedEmit, PluginOptions, PngSpec, SvgSpec } from './types.ts';
import type { LegacyEmitOptions } from './types.ts'; // v2 compat

/**
 * Resolve {@link PluginOptions.emit} (either v3 {@link EmitSpec}[] or v2
 * {@link LegacyEmitOptions}) into a canonical spec array.
 *
 * The returned `specs` are filled in with defaults: `IcoSpec.sizes` falls back
 * to the top-level `sizes`, `IcoSpec.filename` falls back to
 * `opts.output ?? 'favicon.ico'`, `SvgSpec.filename` falls back to
 * `basename(input)`, `PngSpec.filenameTemplate` falls back to
 * `'favicon-{size}x{size}.png'`.
 *
 * When `opts.emit` is omitted, returns a single {@link IcoSpec} using the
 * top-level `sizes` (matches v2 default behavior).
 */
export function normalizeEmit(opts: PluginOptions, defaultSizes: IconSize[]): NormalizedEmit {
	const defaultIcoFilename = opts.output ?? 'favicon.ico';
	const defaultSvgFilename = basename(opts.input);

	if (opts.emit === undefined) {
		return {
			specs: [{ format: 'ico', sizes: defaultSizes, filename: defaultIcoFilename }],
			wasLegacy: false,
		};
	}

	if (Array.isArray(opts.emit)) {
		// v3 shape: fill in defaults per spec.
		const specs: EmitSpec[] = opts.emit.map((spec) =>
			fillSpecDefaults(spec, {
				defaultSizes,
				defaultIcoFilename,
				defaultSvgFilename,
			})
		);
		return { specs, wasLegacy: false };
	}

	if (isLegacyEmit(opts.emit)) {
		return {
			specs: legacyToSpecs(opts.emit, { defaultSizes, defaultIcoFilename, defaultSvgFilename }),
			wasLegacy: true,
		};
	}

	// Unreachable in TypeScript, but JS consumers can pass shapes (`emit: 42`,
	// `emit: null`, etc.) that fail both `Array.isArray` and `isLegacyEmit`.
	// Fail loudly with the offending value instead of silently emitting nothing.
	throw new Error(
		`[svg-to-ico] Invalid \`emit\` value: expected an EmitSpec[] or LegacyEmitOptions object, received ${
			JSON.stringify(opts.emit) ?? String(opts.emit)
		}.`,
	);
}

interface Defaults {
	defaultSizes: IconSize[];
	defaultIcoFilename: string;
	defaultSvgFilename: string;
}

function fillSpecDefaults(spec: EmitSpec, defaults: Defaults): EmitSpec {
	switch (spec.format) {
		case 'ico':
			return {
				format: 'ico',
				sizes: spec.sizes ?? defaults.defaultSizes,
				filename: spec.filename ?? defaults.defaultIcoFilename,
				inject: spec.inject ?? false,
			};
		case 'png':
			return {
				format: 'png',
				sizes: spec.sizes,
				filenameTemplate: spec.filenameTemplate ?? 'favicon-{size}x{size}.png',
				inject: spec.inject ?? false,
			};
		case 'svg':
			return {
				format: 'svg',
				filename: spec.filename ?? defaults.defaultSvgFilename,
				inject: spec.inject ?? false,
			};
		default:
			// Pass through unknown formats unchanged so configResolved validation
			// can throw a clear "invalid format" error with the offending value.
			return spec;
	}
}

/** Translate v2 {@link LegacyEmitOptions} into a v3 {@link EmitSpec}[]. */
function legacyToSpecs(legacy: LegacyEmitOptions, defaults: Defaults): EmitSpec[] {
	const specs: EmitSpec[] = [];

	// `inject` maps: 'minimal' / true → ICO + (SVG if emitted); 'full' → all
	const wantsInjectMinimal = legacy.inject === true || legacy.inject === 'minimal' || legacy.inject === 'full';
	const wantsInjectFull = legacy.inject === 'full';

	// 1. Combined ICO is always emitted (matches v2 behavior).
	const combinedIco: IcoSpec = {
		format: 'ico',
		sizes: defaults.defaultSizes,
		filename: defaults.defaultIcoFilename,
		inject: wantsInjectMinimal,
	};
	specs.push(combinedIco);

	// 2. SVG source (if requested + input is SVG-able).
	const sourceOpt = legacy.source;
	if (sourceOpt !== undefined && sourceOpt !== false) {
		const enabled = typeof sourceOpt === 'object' ? sourceOpt.enabled !== false : sourceOpt === true;
		if (enabled) {
			const svg: SvgSpec = {
				format: 'svg',
				filename: typeof sourceOpt === 'object' && sourceOpt.name
					? sourceOpt.name
					: defaults.defaultSvgFilename,
				inject: wantsInjectMinimal,
			};
			specs.push(svg);
		}
	}

	// 3. Per-size files (`emit.sizes`).
	const sizesOpt = legacy.sizes;
	const wantsPng = sizesOpt === true || sizesOpt === 'png' || sizesOpt === 'both';
	const wantsPerSizeIco = sizesOpt === 'ico' || sizesOpt === 'both';

	if (wantsPng) {
		const png: PngSpec = {
			format: 'png',
			sizes: defaults.defaultSizes,
			filenameTemplate: 'favicon-{size}x{size}.png',
			inject: wantsInjectFull,
		};
		specs.push(png);
	}

	if (wantsPerSizeIco) {
		// `path.parse` strips any trailing extension from the filename only —
		// parent directory components (which may legitimately contain dots,
		// e.g. `icons.v1/favicon.ico`) are preserved as `dir`.
		const { dir, name } = parse(defaults.defaultIcoFilename);
		const outputStem = dir ? `${dir}/${name}` : name;
		for (const size of defaults.defaultSizes) {
			const ico: IcoSpec = {
				format: 'ico',
				sizes: [size],
				filename: `${outputStem}-${size}x${size}.ico`,
				inject: wantsInjectFull,
			};
			specs.push(ico);
		}
	}

	return specs;
}
