import type { HtmlTagDescriptor } from 'vite';

/**
 * Regex matching `<link>` tags whose `rel` is exactly `icon` or `shortcut icon`.
 *
 * Intentionally does **not** match `apple-touch-icon` so those are preserved.
 */
export const INJECT_ICON_LINK_RE = /\s*<link\b[^>]*\brel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>\s*/gi;

/** Escape double quotes in an attribute value so it can be safely emitted inside `"..."`. */
function escapeAttr(v: string): string {
  return v.replace(/"/g, '&quot;');
}

/** Render a Vite {@link HtmlTagDescriptor} as an HTML string. */
export function renderTag(tag: HtmlTagDescriptor): string {
  const attrs = tag.attrs
    ? Object.entries(tag.attrs)
        .filter(([, v]) => v !== false && v !== undefined && v !== null)
        .map(([k, v]) => (v === true ? k : `${k}="${escapeAttr(String(v))}"`))
        .join(' ')
    : '';
  const open = attrs ? `<${tag.tag} ${attrs}>` : `<${tag.tag}>`;
  if (tag.children == null) return open;
  const children = typeof tag.children === 'string' ? tag.children : tag.children.map(renderTag).join('');
  return `${open}${children}</${tag.tag}>`;
}

/**
 * Inject favicon `<link>` tags into an HTML document string.
 *
 * Strips any existing `icon` / `shortcut icon` links (preserving `apple-touch-icon`)
 * and inserts the new tags before `</head>`. If no `</head>` is present, tags are
 * appended at the end of the document.
 */
export function injectTagsIntoHtml(html: string, tags: HtmlTagDescriptor[]): string {
  const cleaned = html.replace(INJECT_ICON_LINK_RE, '');
  const rendered = tags.map(renderTag).join('\n    ');
  const headCloseRe = /<\/head>/i;
  const match = cleaned.match(headCloseRe);
  if (match) {
    return cleaned.replace(headCloseRe, `    ${rendered}\n  ${match[0]}`);
  }
  return `${cleaned}\n${rendered}`;
}
