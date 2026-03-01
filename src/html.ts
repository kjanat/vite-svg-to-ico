import type { HtmlTagDescriptor } from 'vite';

import type { InjectMode } from './types.ts';

/** Metadata for a per-size emitted file. */
export interface SizedFileInfo {
	name: string;
	size: number;
	/** MIME sub-type, e.g. `'png'` or `'x-icon'`. */
	format: string;
}

/** Inputs for building favicon `<link>` tag descriptors. */
export interface FaviconTagOptions {
	output: string;
	sizes: number[];
	sourceEmitted: boolean;
	sourceName: string;
	/** Detected input format: `'svg'`, `'png'`, `'jpg'`, etc. */
	inputFormat: string;
	mode: InjectMode;
	sizedFiles?: SizedFileInfo[];
	/** Vite resolved `base` path (e.g. `'/'`, `'./'`, `'/repo/'`). Defaults to `'/'`. */
	base?: string;
}

/**
 * Build an array of Vite {@link HtmlTagDescriptor}s for favicon `<link>` tags.
 *
 * - **minimal**: ICO (always) + SVG source (if SVG input & source emitted).
 * - **full**: minimal + per-size PNG `<link>` tags.
 *
 * @param opts - Configuration describing which tags to generate.
 * @returns Array of Vite HTML tag descriptors to inject into `<head>`.
 */
export function buildFaviconTags(opts: FaviconTagOptions): HtmlTagDescriptor[] {
	const tags: HtmlTagDescriptor[] = [];
	const base = opts.base ?? '/';

	// 1. ICO — always
	tags.push({
		tag: 'link',
		attrs: {
			rel: 'icon',
			type: 'image/x-icon',
			href: `${base}${opts.output}`,
			sizes: opts.sizes.map((s) => `${s}x${s}`).join(' '),
		},
		injectTo: 'head',
	});

	// 2. SVG source — only for SVG input with source emitted
	if (opts.inputFormat === 'svg' && opts.sourceEmitted) {
		tags.push({
			tag: 'link',
			attrs: {
				rel: 'icon',
				type: 'image/svg+xml',
				href: `${base}${opts.sourceName}`,
				sizes: 'any',
			},
			injectTo: 'head',
		});
	}

	// 3. Per-size PNGs — full mode only
	if (opts.mode === 'full' && opts.sizedFiles) {
		for (const file of opts.sizedFiles) {
			tags.push({
				tag: 'link',
				attrs: {
					rel: 'icon',
					type: `image/${file.format}`,
					sizes: `${file.size}x${file.size}`,
					href: `${base}${file.name}`,
				},
				injectTo: 'head',
			});
		}
	}

	return tags;
}

/**
 * Regex matching `<link>` tags whose `rel` is exactly `icon` or `shortcut icon`.
 *
 * Intentionally does **not** match `apple-touch-icon` so those are preserved.
 */
export const INJECT_ICON_LINK_RE = /\s*<link\b[^>]*\brel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>\s*/gi;
