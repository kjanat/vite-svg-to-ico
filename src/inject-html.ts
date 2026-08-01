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

/** Leading whitespace of `line`, or `undefined` when the line is blank. */
function indentOf(line: string): string | undefined {
	if (line.trim() === '') return undefined;
	return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/**
 * Indentation to give injected tags, copied from the last populated line inside
 * `<head>`. Falls back to one step past the closing tag's own indent, in the
 * document's own whitespace character.
 */
function siblingIndent(head: string, closeIndent: string): string {
	const open = /<head\b[^>]*>/i.exec(head);
	const body = open ? head.slice(open.index + open[0].length) : head;
	for (const line of body.split(/\r?\n/).reverse()) {
		const indent = indentOf(line);
		if (indent !== undefined) return indent;
	}
	return closeIndent + (closeIndent.includes('\t') ? '\t' : '  ');
}

/**
 * Inject favicon `<link>` tags into an HTML document string.
 *
 * Strips any existing `icon` / `shortcut icon` links (preserving `apple-touch-icon`)
 * and inserts the new tags before `</head>`. If no `</head>` is present, tags are
 * appended at the end of the document.
 *
 * Whitespace is copied from the document rather than imposed: tags take the
 * indentation of the last populated line in `<head>`, `</head>` keeps its own,
 * and the document's line ending is reused. A `</head>` that does not start its
 * own line is treated as minified and gets no whitespace at all, so single-line
 * documents stay single-line.
 */
export function injectTagsIntoHtml(html: string, tags: HtmlTagDescriptor[]): string {
	const cleaned = html.replace(INJECT_ICON_LINK_RE, '');
	const match = /<\/head>/i.exec(cleaned);
	if (!match) return `${cleaned}\n${tags.map(renderTag).join('\n')}`;

	const before = cleaned.slice(0, match.index);
	const lineStart = /(\r?\n)([ \t]*)$/.exec(before);
	if (!lineStart) return `${before}${tags.map(renderTag).join('')}${cleaned.slice(match.index)}`;

	const eol = lineStart[1] ?? '\n';
	const closeIndent = lineStart[2] ?? '';
	const tagIndent = siblingIndent(before, closeIndent);
	const rendered = tags.map(renderTag).join(`${eol}${tagIndent}`);
	return `${cleaned.slice(0, lineStart.index)}${eol}${tagIndent}${rendered}${eol}${closeIndent}${
		cleaned.slice(match.index)
	}`;
}
