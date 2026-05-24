/**
 * Type augmentation for `@kjanat/dreamcli` v2.1.0 — covers our patched
 * `.packageJson({ from })` API.
 *
 * Why this file exists:
 *
 * - dreamcli's `package.json` exports list `"types": "./dist/index.d.mts"`
 *   before `"bun": "./src/index.ts"`. TS always matches the `types`
 *   condition first, so it loads the stock `.d.mts` (which lacks the
 *   patched `from` option) even though Bun loads the patched `src/` at
 *   runtime. Result: runtime works, typecheck fails.
 *
 * Augmenting the `CLIBuilder` interface declaration-merges the patched
 * `packageJson` overload onto the existing class, restoring type/runtime
 * parity without touching `dist/` or tsconfig `paths`.
 *
 * **Remove this file once upstream ships the fix and dreamcli's published
 * `.d.mts` declares the `from` option directly.**
 */

import type { PackageJsonData } from '@kjanat/dreamcli';

import '@kjanat/dreamcli';

declare module '@kjanat/dreamcli' {
	interface CLIBuilder {
		/**
		 * Use pre-loaded `package.json` data. Statically resolved at
		 * build/bundle time; no filesystem walk, no `cwd` dependency.
		 *
		 * ```ts
		 * import pkg from './package.json' with { type: 'json' };
		 * cli('mycli').packageJson(pkg);
		 * ```
		 */
		packageJson(data: PackageJsonData): CLIBuilder;
		/**
		 * Auto-discover the nearest `package.json`. Without `from`, walks up
		 * from `cwd` (wrong for installable CLIs). Pass `from: import.meta.url`
		 * so the CLI reports its OWN version, not the consumer's.
		 */
		packageJson(settings?: {
			readonly inferName?: boolean;
			readonly from?: string | URL;
		}): CLIBuilder;
	}
}
