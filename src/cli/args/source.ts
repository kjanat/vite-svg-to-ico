import { isHttpUrl, normalizeInput } from '#loadInput';
import { arg } from '@kjanat/dreamcli';
import { resolve } from 'node:path';

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
