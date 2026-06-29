import { join } from 'node:path';
import { defineConfig } from 'tsdown';
export const outDir = join(import.meta.dirname, 'dist');

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  dts: { entry: 'src/index.ts' },
  /** Keep vite as a `import type` reference in `.d.mts` — consumers resolve
   * it via their own install. Without this the dts plugin walks into vite's
   * type chain and chokes on transitive postcss/lightningcss types. */
  deps: {
    neverBundle: ['vite'],
  },
  exports: {
    bin: { 'svg-to-ico': 'src/cli.ts' },
    exclude: ['cli'],
    customExports(exports) {
      exports['.'] = { types: exports['.'].replace(/\.([mc]?)js$/, '.d.$1ts'), default: exports['.'] };
      return exports;
    },
  },
  outDir,
  clean: true,
  target: 'esnext',
  unused: true,
  onSuccess: 'npm pkg fix',
  unbundle: true,
  minify: 'dce-only',
  publint: true,
  // `@arethetypeswrong/core@0.18.2` breaks on tarball extraction when
  // `fflate@0.8.3` is installed (upstream issue #258). Pinned to `fflate@0.8.2`
  // via root `overrides` until attw's untar handling is fixed.
  attw: { ignoreRules: ['cjs-resolves-to-esm', 'no-resolution'] },
});
