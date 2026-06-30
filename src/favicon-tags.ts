/**
 * The single favicon `<link>` builder, shared by the Vite plugin and the CLI.
 *
 * Consumes the canonical {@link ResolvedInjection}[] from {@link resolveSpecs}
 * and a {@link TagContext}. Centralizes the `base` prefix, cache-busting, and
 * the `data:`-embed escape hatch so neither consumer reimplements them.
 */

import type { ResolvedInjection } from '#resolveSpecs';
import type { HtmlTagDescriptor } from 'vite';

/** Per-build context for {@link buildFaviconTags}. */
export interface TagContext {
  /** URL base prefix for file hrefs (e.g. `'/'`, `'/repo/'`). Defaults to `'/'`. */
  base?: string;
  /** When set, file hrefs get a `?v=<cacheId>` cache-bust param (dev/HMR). */
  cacheId?: string;
  /**
   * Optional per-injection embed resolver. Returns a `data:` URI to inline the
   * favicon bytes, or `undefined` to keep the normal href. Called for *every*
   * injection: the plugin returns a URI only for `embed`-kind injections (bytes
   * from `produce`); the CLI returns one for any injection (bytes read off disk).
   */
  embed?: (inj: ResolvedInjection) => string | Promise<string> | undefined;
}

/** Prepend `base` to a filename (handles missing/trailing slashes). */
export function withBase(base: string, filename: string): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}${filename.replace(/^\/+/, '')}`;
}

/** Append a cache-bust param to a href. `data:` URIs are returned untouched — a query param would corrupt inline bytes. */
export function cacheBust(href: string, cacheId: string): string {
  if (href.startsWith('data:')) return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}v=${cacheId}`;
}

/** Build Vite `<link>` tag descriptors from resolved injections. */
export async function buildFaviconTags(injections: ResolvedInjection[], ctx: TagContext): Promise<HtmlTagDescriptor[]> {
  const base = ctx.base ?? '/';
  const tags: HtmlTagDescriptor[] = [];
  for (const inj of injections) {
    const embedded = ctx.embed ? await ctx.embed(inj) : undefined;
    let href: string;
    if (embedded !== undefined) {
      // Embedded bytes carry no base/cache-bust — the href *is* the content.
      href = embedded;
    } else if (inj.href.kind === 'embed') {
      throw new Error('[svg-to-ico] internal: embed injection reached the builder without a resolver');
    } else {
      href = withBase(base, inj.href.filename);
      if (ctx.cacheId !== undefined) href = cacheBust(href, ctx.cacheId);
    }
    const attrs: Record<string, string> = { rel: inj.rel, type: inj.type, href };
    if (inj.sizes) attrs['sizes'] = inj.sizes;
    tags.push({ tag: inj.tag, attrs, injectTo: 'head' });
  }
  return tags;
}
