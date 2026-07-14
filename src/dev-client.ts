/**
 * Browser-side snippets injected during dev. Kept out of the plugin module so
 * `index.ts` stays a thin assembler. Both snippets skip `data:` hrefs — those
 * carry inline bytes and a cache-bust query param would corrupt them.
 */

import type { HtmlTagDescriptor } from 'vite';

/**
 * HMR snippet: on `svg-to-ico:update`, re-cache-bust every favicon `<link>`
 * so the browser refetches without a full reload.
 */
export const hmrClientCode = `\
if (import.meta.hot) {
  import.meta.hot.on('svg-to-ico:update', (data) => {
    document.querySelectorAll('link[rel]').forEach((link) => {
      // Match only the rels the inject/remove path manages; leave
      // apple-touch-icon and friends alone (mirrors INJECT_ICON_LINK_RE).
      const rel = link.getAttribute('rel')?.trim().toLowerCase();
      if (rel !== 'icon' && rel !== 'shortcut icon') return;
      if (link.href.startsWith('data:')) return;
      const url = new URL(link.href);
      url.searchParams.set('v', data.cacheId);
      link.href = url.toString();
    });
  });
}`;

/**
 * Shim script that creates the favicon `<link>`s at runtime — for backend-
 * rendered HTML or SPA shells outside Vite's HTML pipeline. Appends
 * {@link hmrClientCode} when `hmr` is on.
 */
export function buildShimScript(tags: HtmlTagDescriptor[], hmr: boolean): string {
	const linksJson = JSON.stringify(tags.map((t) => t.attrs).filter(Boolean));
	const script = `\
// svg-to-ico shim: dynamically inject favicon links
const links = ${linksJson};
document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(l => l.remove());
links.forEach(attrs => {
  const link = document.createElement("link");
  Object.entries(attrs).forEach(([k, v]) => link.setAttribute(k, v));
  document.head.appendChild(link);
});`;
	return hmr ? `${script}\n${hmrClientCode}` : script;
}
