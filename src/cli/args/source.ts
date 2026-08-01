import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { cwd } from 'node:process';
import { arg, CLIError } from 'dreamcli';
import { inputExtname, isHttpUrl, normalizeInput } from '#loadInput';
import { SUPPORTED_EXTENSIONS } from '#types';

/**
 * Source-input arg. Accepts filesystem paths (resolved to absolute),
 * `file://` URL strings (converted to paths, then resolved), and `http(s)://`
 * URL strings (passed through; fetched at action time by {@link loadInputBytes}).
 */
export const source = () =>
	arg.custom<string>((raw) => {
		const s = normalizeInput(String(raw));
		return isHttpUrl(s) ? s : resolve(s);
	});

/** Source extensions in "most likely the favicon source" order, for did-you-mean hints. */
const PREFERRED_EXTENSIONS = [...SUPPORTED_EXTENSIONS];

/**
 * Render `path` relative to the invocation directory when it lives inside it.
 * A hint the user can paste back beats an absolute path they have to read.
 */
function display(path: string): string {
	const rel = relative(cwd(), path);
	return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

/** Directory listing, or `[]` when the directory is missing or unreadable. */
async function entriesOf(dir: string): Promise<string[]> {
	try {
		return await readdir(dir);
	} catch {
		return [];
	}
}

/** Whether `name` carries an extension sharp can decode. */
function isSupported(name: string): boolean {
	return SUPPORTED_EXTENSIONS.has(extname(name).toLowerCase());
}

/**
 * A supported image sharing `path`'s basename-without-extension, if one sits
 * beside it — `public/favicon.ico` → `public/favicon.svg`. Whenever the input
 * is wrong, the file that was meant is almost always this one.
 */
async function sameStemSource(path: string): Promise<string | undefined> {
	const dir = dirname(path);
	const stem = basename(path, extname(path));
	const names = new Set(await entriesOf(dir));
	const ext = PREFERRED_EXTENSIONS.find((candidate) => names.has(stem + candidate));
	return ext === undefined ? undefined : display(join(dir, stem + ext));
}

/** Up to `limit` supported images inside `dir`, alphabetically. */
async function imagesIn(dir: string, limit = 3): Promise<string[]> {
	return (await entriesOf(dir)).filter(isSupported).sort().slice(0, limit);
}

/**
 * Reject an unreadable source with a message that names the likely intended
 * file, rather than letting `readFile` surface a bare `ENOENT`/`EISDIR`.
 *
 * `generate` reads a *source* image and writes the ICO, and the common mistake
 * is handing it the ICO path it is supposed to create — hence the three cases
 * covered here: an ICO source, a missing file, a directory.
 *
 * `http(s)://` inputs are left alone; {@link loadInputBytes} already reports
 * fetch failures with URL and status.
 */
export async function assertReadableSource(input: string): Promise<void> {
	if (isHttpUrl(input)) return;
	const path = normalizeInput(input);
	const shown = display(path);
	const details = { input: path };

	// Checked before existence: an ICO that *does* exist is just as wrong as one
	// that does not, and sharp cannot decode the format either way.
	if (inputExtname(path) === '.ico') {
		const twin = await sameStemSource(path);
		throw new CLIError(`Cannot read ${shown}: ICO is an output format, not a source image`, {
			code: 'INPUT_IS_ICO',
			details,
			suggest: twin === undefined
				? `Pass the source image (e.g. icon.svg) and name the ICO with --output ${basename(path)}`
				: `Did you mean '${twin}'? The ICO filename comes from --output (default favicon.ico)`,
		});
	}

	let stats: Awaited<ReturnType<typeof stat>>;
	try {
		stats = await stat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		const twin = await sameStemSource(path);
		const nearby = await imagesIn(dirname(path));
		throw new CLIError(`Source image not found: ${shown}`, {
			code: 'INPUT_NOT_FOUND',
			details,
			suggest: twin !== undefined
				? `Did you mean '${twin}'?`
				: nearby.length > 0
				? `Images in ${display(dirname(path))}: ${nearby.join(', ')}`
				: 'Check the path — <input> is the image to rasterize, not the ICO to create',
		});
	}

	if (stats.isDirectory()) {
		const [first] = await imagesIn(path, 1);
		throw new CLIError(`Cannot read ${shown}: it is a directory, not a source image`, {
			code: 'INPUT_IS_DIRECTORY',
			details,
			suggest: first === undefined
				? `No supported images in ${shown} — pass the image file itself`
				: `Did you mean '${display(join(path, first))}'?`,
		});
	}
}
