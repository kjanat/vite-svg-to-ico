/**
 * The single parse boundary: `PluginOptions` (loose, user-authored) → a
 * validated, fully-defaulted `ResolvedConfig` (strict, internal). Everything
 * downstream — spec resolution, byte production, the Vite hooks — consumes
 * `ResolvedConfig` and trusts it. All option validation lives here and throws
 * eagerly; there is no second validation pass in the plugin hooks.
 *
 * Pure: no Vite `root`/`base` (those are applied at `configResolved` time),
 * no filesystem, no sharp.
 */

import { inspect } from 'node:util';

import { inputBasename, inputExtname, isHttpUrl, normalizeInput } from '#loadInput';
import type { GenerateOptions } from '#raster';
import type { DevOptions, EmitSpec, PluginOptions } from '#types';
import { DATA_URI_ENCODINGS, DEV_INJECTIONS, EMIT_FORMATS, SUPPORTED_EXTENSIONS, SVG_EXTENSIONS } from '#types';

/** Normalize extensions to correct MIME subtypes. */
const MIME_OVERRIDES: Record<string, string> = { jpg: 'jpeg', tif: 'tiff' };

/** Fully-validated, defaulted plugin configuration. The internal source of truth. */
export interface ResolvedConfig {
	/** Canonical input: filesystem path or `http(s)://` URL (URL/`file://` collapsed). */
	input: string;
	inputIsUrl: boolean;
	/** Detected input format token: `'svg'`, `'png'`, `'jpeg'`, … */
	inputFormat: string;
	/** Full MIME type for the source format, e.g. `'image/svg+xml'`. */
	sourceMimeType: string;
	/** Validated top-level sizes (fallback for specs omitting `sizes`). */
	sizes: number[];
	optimize: boolean;
	resize?: GenerateOptions['resize'];
	png?: GenerateOptions['png'];
	dev: Required<DevOptions>;
	/** Spec array with every default filled and range-validated. */
	specs: EmitSpec[];
}

/** Throw a namespaced configuration error. */
function fail(message: string): never {
	throw new Error(`[svg-to-ico] ${message}`);
}

/** Validate that every size is an integer in `[1, max]`; throw listing offenders. */
function assertSizeRange(sizes: readonly number[], max: number, label: string): void {
	const bad = sizes.filter((s) => !Number.isInteger(s) || s < 1 || s > max);
	if (bad.length > 0) fail(`${label} invalid: ${bad.join(', ')}. Must be integers 1–${max}.`);
}

/** Require a value to be a boolean (JS consumers can pass anything). Params typed `unknown` to dodge no-overlap narrowing. */
function assertBoolean(value: unknown, label: string): void {
	if (typeof value !== 'boolean') fail(`${label} must be a boolean.`);
}

/** Require an `inject` value to be `false`, `true`, or `'embed'` (the shape ICO/SVG specs accept). */
function assertSimpleInject(value: unknown, i: number): void {
	if (value !== false && value !== true && value !== 'embed') {
		fail(`emit[${i}].inject must be false, true, or 'embed'.`);
	}
}

interface Defaults {
	sizes: number[];
	icoFilename: string;
	svgFilename: string;
}

/** Fill an {@link EmitSpec}'s optional fields with defaults; unknown formats pass through for validation to reject. */
function fillSpecDefaults(spec: EmitSpec, d: Defaults): EmitSpec {
	switch (spec.format) {
		case 'ico':
			return {
				format: 'ico',
				sizes: spec.sizes ?? d.sizes,
				filename: spec.filename ?? d.icoFilename,
				emit: spec.emit ?? true,
				inject: spec.inject ?? false,
			};
		case 'png':
			return {
				format: 'png',
				sizes: spec.sizes,
				filenameTemplate: spec.filenameTemplate ?? 'favicon-{size}x{size}.png',
				emit: spec.emit ?? true,
				inject: spec.inject ?? false,
			};
		case 'svg':
			return {
				format: 'svg',
				filename: spec.filename ?? d.svgFilename,
				emit: spec.emit ?? true,
				inject: spec.inject ?? false,
				encoding: spec.encoding ?? 'base64',
			};
		default:
			return spec;
	}
}

/** Validate one defaulted spec. Rejects bogus JS shapes so downstream layers only ever see normalized, valid values. */
function validateSpec(spec: EmitSpec, i: number): void {
	if (!(EMIT_FORMATS as readonly string[]).includes(spec.format)) {
		fail(
			`emit[${i}].format invalid: "${spec.format}". Must be one of ${EMIT_FORMATS.map((f) => `'${f}'`).join(', ')}.`,
		);
	}
	assertBoolean(spec.emit, `emit[${i}].emit`);
	if (spec.format === 'ico') {
		assertSimpleInject(spec.inject, i);
		if (!spec.sizes || spec.sizes.length === 0) fail(`emit[${i}] (ico) requires \`sizes\` with at least one value.`);
		else assertSizeRange(spec.sizes, 256, `emit[${i}].sizes`);
	}
	if (spec.format === 'png') {
		if (!spec.sizes || spec.sizes.length === 0) fail(`emit[${i}] (png) requires \`sizes\` with at least one value.`);
		// PNG specs are standalone files — they don't share ICO's 8-bit width/height
		// field, so the 256 cap doesn't apply. Cap at 4096 to catch obvious typos.
		assertSizeRange(spec.sizes, 4096, `emit[${i}].sizes`);
		const inj: unknown = spec.inject;
		const isPlainObject = typeof inj === 'object' && inj !== null && !Array.isArray(inj);
		if (inj !== false && inj !== true && inj !== 'embed' && !isPlainObject) {
			fail(`emit[${i}].inject must be false, true, 'embed', or a { sizes?, embed? } object.`);
		}
		if (isPlainObject) {
			const obj = inj as { sizes?: unknown; embed?: unknown };
			if (obj.embed !== undefined) assertBoolean(obj.embed, `emit[${i}].inject.embed`);
			if (obj.sizes !== undefined) {
				// An empty subset injects nothing yet reports as "configured", masking a
				// spec that silently produces no output — reject it at the boundary.
				if (!Array.isArray(obj.sizes) || obj.sizes.length === 0) {
					fail(`emit[${i}].inject.sizes must be a non-empty subset of spec.sizes.`);
				}
				const allowed = new Set(spec.sizes);
				const bad = obj.sizes.filter((s) => !allowed.has(s));
				if (bad.length > 0) {
					fail(
						`emit[${i}].inject.sizes contains values not in spec.sizes: ${bad.join(', ')}. `
							+ `Must be a subset of [${spec.sizes.join(', ')}].`,
					);
				}
			}
		}
	}
	if (spec.format === 'svg') {
		assertSimpleInject(spec.inject, i);
		if (!(DATA_URI_ENCODINGS as readonly unknown[]).includes(spec.encoding)) {
			fail(
				`emit[${i}].encoding invalid: "${String(spec.encoding)}". Must be ${
					DATA_URI_ENCODINGS.map(
						(e) => `'${e}'`,
					).join(', ')
				}.`,
			);
		}
	}
}

/**
 * Parse and validate {@link PluginOptions} into a {@link ResolvedConfig}.
 * @throws Error (prefixed `[svg-to-ico]`) on any invalid option.
 */
export function parseConfig(opts: PluginOptions): ResolvedConfig {
	const input = opts.input == null ? '' : normalizeInput(opts.input);
	if (!input) fail('`input` must be a non-empty string');

	const inputExt = inputExtname(input);
	if (!SUPPORTED_EXTENSIONS.has(inputExt)) {
		fail(`Unsupported input format: "${inputExt}". Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`);
	}
	const inputIsUrl = isHttpUrl(input);
	const inputFormat = SVG_EXTENSIONS.has(inputExt) ? 'svg' : inputExt.replace('.', '');
	const mimeFormat = MIME_OVERRIDES[inputFormat] ?? inputFormat;
	const sourceMimeType = inputFormat === 'svg' ? 'image/svg+xml' : `image/${mimeFormat}`;

	const rawSizes = opts.sizes ?? [16, 32, 48];
	const sizes = Array.isArray(rawSizes) ? rawSizes : [rawSizes];
	if (sizes.length === 0) fail('`sizes` must contain at least one value');
	assertSizeRange(sizes, 256, 'Invalid sizes:');

	const sharp = opts.sharp;

	const devDefaults: Required<DevOptions> = { enabled: true, injection: 'transform', hmr: true };
	const rawDev = opts.dev ?? true;
	// JS consumers can pass anything. Reject non-boolean/non-object `dev`, and any
	// non-boolean `enabled`/`hmr`, before they get spread in as the wrong type.
	if (typeof rawDev !== 'boolean' && (rawDev === null || typeof rawDev !== 'object' || Array.isArray(rawDev))) {
		fail('`dev` must be a boolean or an object.');
	}
	if (typeof rawDev === 'object') {
		if (rawDev.enabled !== undefined) assertBoolean(rawDev.enabled, '`dev.enabled`');
		if (rawDev.hmr !== undefined) assertBoolean(rawDev.hmr, '`dev.hmr`');
	}
	const dev: Required<DevOptions> = typeof rawDev === 'boolean'
		? { ...devDefaults, enabled: rawDev }
		: { ...devDefaults, ...rawDev };
	if (
		typeof rawDev === 'object'
		&& rawDev.injection !== undefined
		&& !(DEV_INJECTIONS as readonly string[]).includes(rawDev.injection)
	) {
		fail(
			`Invalid dev.injection value: "${rawDev.injection}". Must be ${DEV_INJECTIONS.map((m) => `'${m}'`).join(', ')}.`,
		);
	}

	const defaults: Defaults = {
		sizes,
		icoFilename: opts.output ?? 'favicon.ico',
		svgFilename: inputBasename(input),
	};
	// `emit` is typed `EmitSpec[]`, but JS consumers can pass anything. Only
	// `undefined` falls back to the default; non-array values (incl. `null`,
	// numbers, BigInt) are rejected with a readable repr via `inspect`.
	if (opts.emit !== undefined && !Array.isArray(opts.emit)) {
		fail(
			`Invalid \`emit\` value: expected an EmitSpec[], received ${
				inspect(opts.emit, { depth: 2, breakLength: Infinity })
			}.`,
		);
	}
	const specs = (opts.emit ?? [{ format: 'ico' }]).map((spec) => fillSpecDefaults(spec, defaults));
	specs.forEach(validateSpec);

	return {
		input,
		inputIsUrl,
		inputFormat,
		sourceMimeType,
		sizes,
		optimize: sharp?.optimize ?? true,
		resize: sharp?.resize,
		png: sharp?.png,
		dev,
		specs,
	};
}
