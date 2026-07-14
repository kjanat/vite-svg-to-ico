/**
 * Stateful favicon-byte production with caching, extracted from the plugin so
 * it can be tested without driving Vite. Generates PNGs once for the union of
 * required sizes, then assembles each {@link ResolvedFile} (ICO container, PNG,
 * source copy) and memoizes embedded `data:` URIs. `reset()` drops the caches
 * for an HMR cycle.
 */

import type { ResolvedConfig } from '#config';
import { toDataUri } from '#dataUri';
import { packIco } from '#ico';
import { loadInputBytes } from '#loadInput';
import { generateSizedPngs, type SizedPng } from '#raster';
import type { ResolvedFile, ResolvedInjection } from '#resolveSpecs';
import type { IconSize } from '#types';

export class AssetProducer {
	#pngs: SizedPng[] | null = null;
	#inputBuffer: Buffer | null = null;
	#embedUris = new Map<ResolvedInjection, string>();
	/** Source path/URL to read; the abs filesystem path is set in `configResolved`. */
	#input: string;

	constructor(
		private readonly cfg: ResolvedConfig,
		private readonly requiredSizes: IconSize[],
	) {
		this.#input = cfg.input;
	}

	/** Point byte production at the Vite-resolved absolute input path. */
	setResolvedInput(input: string): void {
		this.#input = input;
	}

	/** Read + cache the source input buffer (filesystem or http(s) URL). */
	async inputBytes(): Promise<Buffer> {
		if (!this.#inputBuffer) this.#inputBuffer = await loadInputBytes(this.#input);
		return this.#inputBuffer;
	}

	/** Generate (once) and return PNGs for every required size. */
	async pngs(): Promise<SizedPng[]> {
		if (!this.#pngs) {
			// URLs are fetched once and cached; sharp accepts the Buffer directly.
			// Filesystem paths pass through so sharp opens the file itself.
			const src = this.cfg.inputIsUrl ? await this.inputBytes() : this.#input;
			this.#pngs = await generateSizedPngs(src, {
				sizes: this.requiredSizes,
				optimize: this.cfg.optimize,
				resize: this.cfg.resize,
				png: this.cfg.png,
			});
		}
		return this.#pngs;
	}

	/** Find a generated PNG of `size`, or throw if the size wasn't requested. */
	async #pngOfSize(size: IconSize): Promise<SizedPng> {
		const png = (await this.pngs()).find((p) => p.size === size);
		if (!png) throw new Error(`[svg-to-ico] internal: missing PNG size ${size}`);
		return png;
	}

	/** Produce the bytes for a resolved file. */
	async produce(file: ResolvedFile): Promise<Buffer> {
		const source = file.source;
		switch (source.kind) {
			case 'source-copy':
				return this.inputBytes();
			case 'png':
				return (await this.#pngOfSize(source.size)).buffer;
			case 'single-ico':
				return packIco([await this.#pngOfSize(source.size)]);
			case 'combined-ico': {
				const all = await this.pngs();
				const subset = source.sizes
					.map((s) => all.find((p) => p.size === s))
					.filter((p): p is SizedPng => p !== undefined);
				return packIco(subset);
			}
		}
	}

	/** Produce (and memoize) the `data:` URI for an embed injection from the same bytes the emitter uses. */
	async embedUri(inj: ResolvedInjection): Promise<string> {
		const cached = this.#embedUris.get(inj);
		if (cached !== undefined) return cached;
		if (inj.href.kind !== 'embed') throw new Error('[svg-to-ico] internal: embedUri called on a non-embed injection');
		const bytes = await this.produce({ filename: '', mime: '', source: inj.href.source });
		const uri = toDataUri(bytes, inj.type, inj.href.encoding);
		this.#embedUris.set(inj, uri);
		return uri;
	}

	/** Content-Type header for a file based on its mime subtype. */
	contentType(mime: string): string {
		return mime === 'svg+xml' ? this.cfg.sourceMimeType : `image/${mime}`;
	}

	/** Drop all caches so the next access regenerates (HMR). */
	reset(): void {
		this.#pngs = null;
		this.#inputBuffer = null;
		this.#embedUris.clear();
	}
}
