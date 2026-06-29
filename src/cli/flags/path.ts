import { flag } from '@kjanat/dreamcli';
import { resolve } from 'node:path';

/** Resolve a raw string to an absolute filesystem path (relative to CWD). */
const toAbsolutePath = (raw: unknown): string => resolve(String(raw));

/** Reusable absolute-path flag: parsing happens at the schema layer. */
export const pathFlag = () => flag.custom<string>(toAbsolutePath);
