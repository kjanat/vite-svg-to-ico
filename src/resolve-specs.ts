/**
 * Resolution layer between the user-facing {@link EmitSpec} array and the
 * plugin's emit/inject machinery.
 *
 * Given a normalized {@link EmitSpec}[] + the input format, produce:
 *
 * - `files`: a flat list of files to write to disk (or serve in dev), each
 *   labelled with the source PNG size it needs (or "source-copy" for the SVG).
 * - `injections`: a flat list of `<link>` tag specs to inject into HTML, with
 *   `href` *unresolved* — the call site is responsible for prepending the
 *   Vite `base` and applying cache-busting.
 * - `requiredSizes`: the union of every size mentioned in any spec, so the
 *   plugin can call `generateSizedPngs(input, { sizes: requiredSizes })` once
 *   and look up PNGs by size when producing each file.
 *
 * This module knows nothing about Vite, sharp, or filesystems — it's a pure
 * data transform. The plugin layer plugs it into `emitFile`, dev middleware,
 * and `transformIndexHtml`.
 */

import { type IconSize, parseSize } from '#size';
import type { DataUriEncoding, EmitSpec } from '#types';

/** One file the plugin will produce on disk (build) or serve at a URL (dev). */
export interface ResolvedFile {
	/** Path relative to output dir (build) or URL path (dev). */
	filename: string;
	/** MIME sub-type without the `image/` prefix (e.g. `'x-icon'`, `'png'`, `'svg+xml'`). */
	mime: string;
	/** How to produce this file's bytes. */
	source: ResolvedFileSource;
}

/**
 * How a {@link ResolvedFile}'s bytes are produced. Discriminated by `kind`:
 *
 * - `combined-ico` — pack multiple PNG sizes into one ICO container.
 * - `single-ico` — wrap exactly one PNG size in a single-entry ICO.
 * - `png` — emit the PNG for one size as-is.
 * - `source-copy` — copy the original input file (SVG inputs only).
 */
export type ResolvedFileSource =
	| { kind: 'combined-ico'; sizes: IconSize[] }
	| { kind: 'single-ico'; size: IconSize }
	| { kind: 'png'; size: IconSize }
	| { kind: 'source-copy' };

/**
 * Where an injected `<link>`'s `href` comes from. Discriminated by `kind`:
 *
 * - `file` — points at an emitted file; the plugin prepends `base` and a
 *   cache-bust param to {@link filename}.
 * - `embed` — inlines the bytes as a `data:` URI; the plugin produces the
 *   bytes from {@link source} (the same producer used for emitted files) and
 *   encodes them per {@link encoding}. No `base`/cache-bust applies.
 *
 * Splitting these keeps illegal states unrepresentable: a file href has no
 * bytes, an embed href has no filename.
 */
export type InjectionHref =
	| { kind: 'file'; filename: string }
	| { kind: 'embed'; source: ResolvedFileSource; encoding: DataUriEncoding };

/** One `<link>` tag to inject. The plugin layer resolves {@link href} into a concrete string. */
export interface ResolvedInjection {
	tag: 'link';
	rel: 'icon';
	type: string;
	/** How to fill the tag's `href` — a file reference or inlined bytes. */
	href: InjectionHref;
	/** Optional `sizes` attribute (`'16x16 32x32'` for ICO, `'any'` for SVG, `'NxN'` for per-size PNG). */
	sizes?: string;
}

/** Output of {@link resolveSpecs}. */
export interface SpecResolution {
	files: ResolvedFile[];
	injections: ResolvedInjection[];
	/** Union of every size mentioned in any spec — feed this to `generateSizedPngs`. */
	requiredSizes: IconSize[];
	/** Whether at least one spec injects a tag (drives the no-op warning when transformIndexHtml never fires). */
	hasAnyInjection: boolean;
	/** Non-fatal configuration warnings (e.g. a spec that emits nothing and injects nothing). */
	warnings: string[];
}

/**
 * Build the no-output warning for a spec that neither writes a file nor inlines
 * bytes, or `null` when the spec produces something. `hasInject` distinguishes
 * "a URL link to a file that won't exist" from "nothing configured at all".
 */
function noOutputWarning(
	index: number,
	format: string,
	willEmit: boolean,
	producesEmbed: boolean,
	hasInject: boolean,
): string | null {
	if (willEmit || producesEmbed) return null;
	return hasInject
		? `emit[${index}] (${format}): \`inject\` links a file but \`emit\` is false, so the target won't exist. Use \`inject: 'embed'\` to inline the bytes, or set \`emit: true\`.`
		: `emit[${index}] (${format}): \`emit: false\` with no \`inject\` produces no output. Remove the spec or enable one.`;
}

/** Resolve normalized specs into the file and injection lists the plugin layer consumes. */
export function resolveSpecs(specs: EmitSpec[], ctx: { inputFormat: string }): SpecResolution {
	const files: ResolvedFile[] = [];
	const injections: ResolvedInjection[] = [];
	const sizeSet = new Set<IconSize>();
	const warnings: string[] = [];

	for (const [i, spec] of specs.entries()) {
		switch (spec.format) {
			case 'ico': {
				const sizes = (spec.sizes ?? []).map((s) => parseSize(s, 256));
				const filename = spec.filename ?? 'favicon.ico';
				for (const s of sizes) sizeSet.add(s);
				const [only] = sizes;
				const source: ResolvedFileSource = sizes.length === 1 && only !== undefined
					? { kind: 'single-ico', size: only }
					: { kind: 'combined-ico', sizes };
				const willEmit = spec.emit ?? true;
				if (willEmit) files.push({ filename, mime: 'x-icon', source });
				if (spec.inject) {
					injections.push({
						tag: 'link',
						rel: 'icon',
						type: 'image/x-icon',
						href: spec.inject === 'embed' ? { kind: 'embed', source, encoding: 'base64' } : { kind: 'file', filename },
						sizes: sizes.map((s) => `${s}x${s}`).join(' '),
					});
				}
				const w = noOutputWarning(i, 'ico', willEmit, spec.inject === 'embed', !!spec.inject);
				if (w) warnings.push(w);
				break;
			}
			case 'png': {
				const tmpl = spec.filenameTemplate ?? 'favicon-{size}x{size}.png';
				const inj = spec.inject;
				// Which sizes get a tag (membership only — kept as raw numbers), and
				// whether those tags inline the bytes.
				let injectSizes: Set<number> | null;
				let embed = false;
				if (inj === true) {
					injectSizes = new Set(spec.sizes);
				} else if (inj === 'embed') {
					injectSizes = new Set(spec.sizes);
					embed = true;
				} else if (inj && typeof inj === 'object') {
					injectSizes = new Set(inj.sizes ?? spec.sizes);
					embed = inj.embed ?? false;
				} else {
					injectSizes = null;
				}
				const willEmit = spec.emit ?? true;
				for (const rawSize of spec.sizes) {
					const size = parseSize(rawSize, 4096);
					sizeSet.add(size);
					const filename = tmpl.replace(/\{size\}/g, String(size));
					const source: ResolvedFileSource = { kind: 'png', size };
					if (willEmit) files.push({ filename, mime: 'png', source });
					if (injectSizes?.has(size)) {
						injections.push({
							tag: 'link',
							rel: 'icon',
							type: 'image/png',
							href: embed ? { kind: 'embed', source, encoding: 'base64' } : { kind: 'file', filename },
							sizes: `${size}x${size}`,
						});
					}
				}
				const w = noOutputWarning(i, 'png', willEmit, embed && injectSizes !== null, inj != null && inj !== false);
				if (w) warnings.push(w);
				break;
			}
			case 'svg': {
				// Source copy is only meaningful for SVG inputs.
				if (ctx.inputFormat !== 'svg') break;
				const willEmit = spec.emit ?? true;
				const isEmbed = spec.inject === 'embed';
				const filename = spec.filename ?? 'favicon.svg';
				const source: ResolvedFileSource = { kind: 'source-copy' };
				if (willEmit) files.push({ filename, mime: 'svg+xml', source });
				if (spec.inject) {
					injections.push({
						tag: 'link',
						rel: 'icon',
						type: 'image/svg+xml',
						href: isEmbed ? { kind: 'embed', source, encoding: spec.encoding ?? 'base64' } : { kind: 'file', filename },
						sizes: 'any',
					});
				}
				const w = noOutputWarning(i, 'svg', willEmit, isEmbed, !!spec.inject);
				if (w) warnings.push(w);
				break;
			}
		}
	}

	return {
		files,
		injections,
		requiredSizes: [...sizeSet].sort((a, b) => a - b),
		hasAnyInjection: injections.length > 0,
		warnings,
	};
}
