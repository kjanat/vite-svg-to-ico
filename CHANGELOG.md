# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.1.0] - 2026-07-15

### Added

- Add context-aware colors and OSC 8 file links throughout the `svg-to-ico`
  CLI. Help, examples, generated-file paths, rewritten HTML paths, warnings,
  and errors now use DreamCLI's gated `ansispeck` palette. `NO_COLOR`,
  `FORCE_COLOR`, `--color`, and `--no-color` are honored automatically.
- Add JSON command-definition output through `--help --json` for root and
  command help, provided by DreamCLI 3.

### Changed

- Upgrade `@kjanat/dreamcli` from `^2.5.0` to `^3.0.0-rc.9` and use its
  built-in themed help, path flags, and numeric array constraints instead of
  local color, path, and size-validation implementations. CLI help now follows
  the live terminal width, and validation errors use DreamCLI's standard
  diagnostics.

## [4.0.0] - 2026-06-30

### Removed (BREAKING)

- Dropped the v2 `emit: { source, sizes, inject }` object shape — `emit` now
  accepts only an `EmitSpec[]` array. Removed the exported types
  `LegacyEmitOptions`, `EmitOptions`, `isLegacyEmit`, `NormalizedEmit`,
  `IncludeSourceOptions`, `EmitSizesFormat`, and `EMIT_SIZES_FORMATS`.
- Removed the inert `--mode`/`-m` flag from the `svg-to-ico inject` CLI and the
  now-unused `InjectMode` / `INJECT_MODES` exports — the flag never affected
  output (the CLI emits ICO + optional SVG links regardless).

  | v2 (removed)                                | v3/v4                                                                      |
  | ------------------------------------------- | -------------------------------------------------------------------------- |
  | `emit: { source: true }`                    | `emit: [{ format: 'ico' }, { format: 'svg' }]`                             |
  | `emit: { sizes: 'png' }`                    | `emit: [{ format: 'ico' }, { format: 'png', sizes: [16, 32, 48] }]`        |
  | `emit: { sizes: 'ico' }`                    | `emit: [{ format: 'ico' }, { format: 'ico', sizes: [n], filename: … }, …]` |
  | `emit: { source: true, inject: 'minimal' }` | `emit: [{ format: 'ico', inject: true }, { format: 'svg', inject: true }]` |
  | `emit: { inject: 'full', sizes: 'png' }`    | add `{ format: 'png', sizes: […], inject: true }` to the array             |

### Internal

- Restructured the library internals (`src/*.ts`) by pipeline stage: a single
  `parseConfig` boundary (`config.ts`) replaces three scattered parse/validate
  sites; one shared favicon-tag builder (`favicon-tags.ts`) serves both the
  plugin and the CLI (removing the duplicated `withBase`/`<link>` logic); byte
  production moves into a testable `AssetProducer` (`assets.ts`); `index.ts`
  shrinks from ~600 to ~300 lines. `ico.ts` split into `raster.ts` (sharp) +
  `ico.ts` (packing); `html.ts` split into `favicon-tags.ts` + `inject-html.ts`.
  `IconSize` is now a branded type produced by `parseSize` at the boundary
  (public option fields remain plain `number`). No runtime behavior change
  beyond the v2 removal above.

### Added

- Embed favicons inline as `data:` URIs instead of (or alongside) emitting
  files. Each `ico`/`png`/`svg` emit spec gains two orthogonal knobs:
  - `inject: 'embed'` — the injected `<link>`'s `href` carries the image
    bytes as a `data:` URI (base64 for binary, configurable for SVG) rather
    than pointing at a file.
  - `emit: false` — skip writing the file to disk; only meaningful with
    `inject: 'embed'` (embed without a file). Defaults to `true`.
  - `SvgSpec.encoding: 'base64' | 'utf8'` — `utf8` produces a smaller,
    human-readable `data:image/svg+xml,…` URI. Defaults to `'base64'`.
  - PNG specs also accept `{ sizes, embed: true }` to inline a subset.

  Data-URI hrefs are never cache-busted (a query param would corrupt the
  bytes), and the dev HMR client skips them. A spec that writes nothing and
  injects nothing now emits a one-time config warning.

- `svg-to-ico inject` gained matching `--embed` / `--encoding` / `--asset-dir`
  flags: inline the referenced ICO (and SVG `--source`) straight into the
  rewritten HTML as `data:` URIs instead of URL `<link href>`s. Assets are
  read from `--asset-dir` (default: each HTML file's own directory).

### Changed

- CLI help/deprecation output now renders OSC 8 terminal hyperlinks
  (clickable CHANGELOG/repo links) via `@kjanat/dreamcli` `^2.5.0`'s
  `.manifest()`/`.links()`, replacing the static `.version(pkg.version)`
  wiring. No flags, arguments, or behavior change.

### Build

- Publish dist-only: dropped `src` from `files` and removed the `bun`
  export condition. Consumers resolve `dist/` everywhere; the published
  tarball no longer ships TypeScript source.
- Modularized the CLI: `src/cli.ts` split into `src/cli/` units
  (`commands/{generate,inject}`, `args/source`, `flags/{sizes,path}`,
  `colors`); internal relative imports migrated to `#`-prefixed subpath
  imports declared in `package.json`. No public API change.
- dprint `^0.54` → `^0.55.1` with the remote config pinned to commit
  `e5f1f678` (repo-wide reflow); bumped `@typescript/native-preview` and
  `runner-run`. Moved `scripts/smoke-setup.ts` → `preload.ts`.

## [3.1.6] - 2026-06-24

### Changed

- Bump runtime dependencies: `sharp` `^0.34.5` → `^0.35` and
  `@kjanat/dreamcli` `^2.1.0` → `^2.4`. No API or behavior changes; this
  release exists so the updated dependency ranges reach published
  consumers.

## [3.1.5] - 2026-06-01

### Fixed

- CLI `generate --help` now shows `--out-dir`'s default as `.` instead of
  embedding the absolute current working directory from the help invocation.
  Runtime behavior is unchanged: omitting `--out-dir` writes to the directory
  where `svg-to-ico generate` is executed.

## [3.1.4] - 2026-05-25

### Fixed

- CLI `--version` actually works for installed/`npx`/`bunx` consumers now
  (third time's the charm — sorry). 3.1.3 shipped a fix that depended on a
  local `bun patch` of `@kjanat/dreamcli`; patches don't propagate via npm,
  so consumers got vanilla dreamcli where `.packageJson()` walks up from
  `cwd` and either reports the wrong version or errors out as
  `Unknown flag --version`. This release switches to dreamcli's stable
  `.version(string)` API and reads the version statically via a `#pkg`
  subpath import. Bundler-resolved at build time, no runtime fs walk, no
  patch required, works against stock `@kjanat/dreamcli@2.1.0`.

### Removed

- `patches/@kjanat%2Fdreamcli@2.1.0.patch` and the `patchedDependencies`
  entry in `package.json`. The dreamcli patch added a `.packageJson(data)`
  overload + `from` option for the same problem; useful as an upstream
  contribution (still filed as
  [kjanat/dreamcli#18](https://github.com/kjanat/dreamcli/issues/18)),
  unnecessary as a local workaround.
- `types/dreamcli-augment.d.ts`. The module augmentation existed only to
  add the patched `.packageJson()` overloads to dreamcli's stock `.d.mts`.
  No longer needed.

### Build

- `tsdown.config.ts`: replaced deprecated `external` with `deps.neverBundle`
  (rolldown rename). Keeps `vite` as an `import type` reference in `.d.mts`
  instead of inlining its type chain (which pulls postcss/lightningcss
  CJS-style declarations that `rolldown-plugin-dts` can't reliably bundle).
- Added `overrides.fflate: "0.8.2"` so `@arethetypeswrong/core@0.18.2`'s
  built-in untar parser keeps working. `fflate@0.8.3` changed `Gunzip`
  stream semantics in a way that breaks attw's tarball extraction
  ([arethetypeswrong#258](https://github.com/arethetypeswrong/arethetypeswrong.github.io/issues/258)).

## [3.1.3] - 2026-05-24

### Fixed

- CLI `--version` now reports the package's own version regardless of the
  caller's working directory. 3.1.2 reordered `.packageJson()` in the dreamcli
  chain, which was a red herring; the real root cause is that dreamcli's
  `.packageJson()` walks up from `process.cwd()`, so an installed CLI
  (`bunx`, `npx`, global install) reports the consumer's project version
  (or errors out as `Unknown flag --version` when no `package.json` is
  reachable). Now we read our own `package.json` statically via a `#pkg`
  subpath import and pass it through a new `.packageJson(data)` overload
  added to a patched `@kjanat/dreamcli`. Filed upstream as
  [kjanat/dreamcli#18](https://github.com/kjanat/dreamcli/issues/18).

### Changed

- Dropped `peerDependencies.vite`. The previous range
  (`^6.0.0 || ^7.0.0 || ^8.0.0`) advertised compatibility that was never
  exercised against vite 6 or 7. The plugin only uses stable hooks
  (`configResolved`, `transformIndexHtml`, dev middleware, asset emission)
  and works against any modern vite, but we won't claim what we don't test.
- Added `overrides.vite` so workspace installs (root + smoke fixture) resolve
  to a single vite version, avoiding nominal-type clashes across `node_modules`.

### Internal

- New `#pkg` subpath import maps to `./package.json` so `src/cli.ts` can
  consume its own metadata via `import pkg from '#pkg'` (bundler-resolved
  at build time).
- New `types/dreamcli-augment.d.ts` declaration-merges the patched
  `.packageJson()` overloads onto `CLIBuilder` (dreamcli ships
  `dist/*.d.mts` ahead of `src/` in its exports map, so TS sees the stock
  types even though Bun loads the patched `src/`).
- `patches/@kjanat%2Fdreamcli@2.1.0.patch` adds the `(data)` overload, a
  `from: string | URL` setting, and ships them through `discoverPackageJson`
  and the runtime preflight. Removable once dreamcli ships the upstream fix.

## [3.1.2] - 2026-05-24

### Fixed

- CLI: `svg-to-ico --version` no longer errors with `Unknown flag --version`.
  Root cause: `.packageJson()` was being chained _after_ `.description()` on
  the dreamcli builder; the version flag is only registered when
  `.packageJson()` is called first in the chain.

### Documentation

- README Options table: `input` type widened from `string` to `string | URL`
  (was stale from 3.1.0; missed in 3.1.1's README pass).
- README: added `npx -y --package=vite-svg-to-ico svg-to-ico …` invocation
  example next to the globally-installed CLI form so consumers can try the
  remote/URL input without installing the package first.

## [3.1.1] - 2026-05-24

### Documentation

- Document remote / URL input support in README. 3.1.0 shipped the feature
  without updating the README; this release adds a short `Remote / URL input`
  section under Usage. No code changes.

## [3.1.0] - 2026-05-24

### Added

- **URL input support**: `PluginOptions.input` and the `generate` CLI subcommand
  now accept `http(s)://` URLs in addition to filesystem paths.
  Remote sources are fetched once per build via the global `fetch` and cached;
  HMR (file watching) still only applies to local paths.
  Query strings are stripped for basename/extension detection,
  so `https://example.com/icon.svg?v=2` is recognised as SVG
  and copied out as `icon.svg` when `--emit-source` is set.
- **`URL` instances + `file://` URLs**: `PluginOptions.input` is widened to
  `string | URL`. Plain strings, `URL` instances, and `file://` URLs
  (string or instance) are all accepted; `file://` inputs are converted to
  filesystem paths via `fileURLToPath`. CLI `generate` accepts `file://`
  URL strings on the command line.
- New module `src/load-input.ts` exposing `SourceInput`, `normalizeInput()`,
  `isHttpUrl()`, `inputBasename()`, `inputExtname()`, and `loadInputBytes()`.
  Internal helpers used by the plugin and CLI; usable directly by consumers
  that want the same path-or-URL handling.

### Changed

- `PluginOptions.input` type widened from `string` to `string | URL`
  (additive; existing string consumers are unaffected).
- `generate` CLI subcommand's `input` arg description updated to mention
  `file://` and `http(s)://` URL support.

## [3.0.0] - 2026-05-12

### Added

- **New `emit` API**: per-format spec array.
  Each entry is one of `IcoSpec`, `PngSpec`, or `SvgSpec` —
  every output is independently configured for sizes, filename, and injection.
  Mix-and-match across formats is now first-class
  (e.g. PNG at 192 only, ICO at 16/32/48, SVG copy injected as a separate `<link>`).
- New types: `EmitSpec`, `IcoSpec`, `PngSpec`, `SvgSpec`,
  `EmitFormat`, `EMIT_FORMATS`, `NormalizedEmit`, `LegacyEmitOptions`,
  `isLegacyEmit()`.
- New internal modules: `src/normalize-emit.ts` (v2→v3 shim + defaults),
  `src/resolve-specs.ts` (pure spec→files+injections resolver).
- Per-spec sizes validation: ICO/top-level capped at 1–256
  (8-bit width/height field in the ICO container);
  `PngSpec.sizes` capped at 1–4096 since standalone PNGs aren't bound
  by ICO's limit (covers Android 192, PWA 512, retina 1024).
  Empty `sizes` is rejected for both ICO and PNG.
  Validation errors point at the failing `emit[N]`.
- Named `svgToIco` export alongside the existing default export.
  Both forms now work — pick whichever fits your codebase's import style.
- `PngSpec.inject.sizes` validated as a subset of the spec's own `sizes`
  at config time;
  previously an out-of-set value was silently dropped at injection time.

### Changed

- **BREAKING:** `PluginOptions.emit` is now `EmitSpec[] | LegacyEmitOptions`.
  The v2 object shape (`{ source, sizes, inject }`)
  still works via a compatibility shim
  and logs a one-time deprecation warning per build.
  Will be removed in v4.
- **BREAKING (soft):** `PluginOptions.output` is now `@deprecated`.
  It still works as the fallback ICO filename
  when an `IcoSpec` omits its own `filename`,
  but the recommended placement is `IcoSpec.filename` directly.
- Plugin internals rewritten to consume the resolved spec array end-to-end
  (no more separate `emit.source` / `emit.sizes` / `emit.inject` code paths).
- The "inject was requested but `transformIndexHtml` never fired" warning
  is now spec-aware: triggered whenever any spec has `inject: true`,
  regardless of v2 vs v3 input shape.

### Fixed

- Invalid runtime `emit` values (e.g. `emit: 42`, `emit: null`, `emit: 1n`
  from JS consumers) now throw a clear error with the offending value
  serialised via `util.inspect`,
  instead of silently producing an empty spec list
  (or, for `BigInt`, crashing inside the Error constructor).
- Per-size ICO filenames in the legacy `emit.sizes: 'ico' | 'both'` path
  preserve dots in parent directory components.
  A configured `output: 'icons.v1/favicon'` previously collapsed to `icons`
  because the extension-stripping regex matched across `/`;
  now derived via `path.parse` which strips only the basename's extension.

### Migration guide

Old (v2):

```ts
svgToIco({
  input: 'src/icon.svg',
  output: 'favicon.ico',
  sizes: [16, 32, 48],
  emit: { source: true, sizes: 'both', inject: 'full' },
});
```

New (v3 equivalent):

```ts
svgToIco({
  input: 'src/icon.svg',
  emit: [
    { format: 'ico', sizes: [16, 32, 48], filename: 'favicon.ico', inject: true },
    { format: 'ico', sizes: [16], filename: 'favicon-16x16.ico', inject: true },
    { format: 'ico', sizes: [32], filename: 'favicon-32x32.ico', inject: true },
    { format: 'ico', sizes: [48], filename: 'favicon-48x48.ico', inject: true },
    { format: 'png', sizes: [16, 32, 48], inject: true },
    { format: 'svg', inject: true },
  ],
});
```

Or, to use the new flexibility that v2 couldn't express
(combined ICO 16/32/48, PNG 192 only, SVG as a fallback `<link>`):

```ts
svgToIco({
  input: 'src/icon.svg',
  emit: [
    { format: 'ico', sizes: [16, 32, 48], inject: true },
    { format: 'png', sizes: [192], inject: true },
    { format: 'svg', inject: true },
  ],
});
```

## [2.3.1] - 2026-05-12

### Changed

- CLI wires `.packageJson()` into the dreamcli builder so `svg-to-ico --version`
  and the help footer auto-sync with the published package version instead of
  needing a manual `.version()` call.

## [2.3.0] - 2026-05-12

### Added

- `svg-to-ico` CLI binary (shipped by this package; not tied to Vite).
  Two subcommands:
  `generate` (ICO + per-size files from any sharp-supported source image)
  and `inject` (rewrite `<link rel="icon">` tags into existing HTML files).
  Built on `@kjanat/dreamcli`.
  Use as a `"postbuild"` script in `package.json`
  for frameworks that render HTML outside Vite's pipeline
  (SvelteKit, VitePress, Astro adapters),
  where the plugin's `transformIndexHtml` never fires.
  (https://github.com/kjanat/vite-svg-to-ico/issues/1)
- `renderTag` and `injectTagsIntoHtml` helpers in `src/html.ts` (internal),
  shared between the plugin and CLI.
- `engines: { node: ">=22.18.0" }` field;
  the CLI relies on modern Node features.

### Changed

- Package internal import resolution
  moved from `tsconfig` path aliases
  to Node-spec `package.json` `imports` field
  (`#vite-svg-to-ico` for the public entry,
  `#internals/*` for source-relative imports).
- `buildFaviconTags` normalizes `base` (trailing-slash safe)
  and strips leading slashes from joined segments —
  `--base /app` and `--base /app/` now yield identical `/app/favicon.ico` hrefs.
- `injectTagsIntoHtml` matches `</head>` case-insensitively
  and preserves the original tag casing in output.

### Fixed

- README: dropped the unrunnable `npm i -g …` placeholder;
  full `npm i -g vite-svg-to-ico` command shown.
- CLI `generate`: parent directories of nested `--output` paths
  (e.g. `icons/favicon.ico`) are created before writing
  instead of failing with `ENOENT`.
- CLI `inject`: only `ENOENT` is treated as "file not found, skipping";
  permission and other I/O errors
  are no longer mislabeled and silently swallowed.

## [2.2.0] - 2026-05-12

### Added

- Build-time warning
  when `emit.inject` is configured
  but Vite's `transformIndexHtml` is never called
  (e.g. SvelteKit, VitePress build, some Astro adapters).
  The plugin now logs a clear message
  instead of silently producing files with no `<link>` tags injected.
  Verified end-to-end against a real SvelteKit `adapter-static` build.
  (https://github.com/kjanat/vite-svg-to-ico/issues/1)

### Fixed

- Warning is now gated on `this.environment?.name === 'client'`.
  Multi-environment Vite builds (SvelteKit drives client + ssr)
  called `closeBundle` per environment,
  causing the warning to print twice;
  only the client environment ever triggers `transformIndexHtml`,
  so the SSR-side duplicate was pure noise.
- `buildTransformIndexHtmlCalled` flag resets in `buildStart`,
  fixing stale state across build cycles in watch mode.

## [2.1.0] - 2026-05-12

### Added

- `autofix.ci` workflow for automatic dprint formatting on push and PRs.
- Vite 8 peer dependency support
  (`vite: ^6.0.0 || ^7.0.0 || ^8.0.0`);
  installs no longer rejected on Vite 8 projects.

### Changed

- Publish workflow:
  `--frozen-lockfile`, strict tag pattern,
  prerelease `next`/`latest` tag via `actions/github-script`,
  `bun i -g npm`,
  rely on `prepublishOnly` for test+typecheck gate.

## [2.0.1] - 2026-03-01

### Fixed

- Injected favicon `<link>` tags now respect Vite's `base` config.
  Previously, hrefs were always absolute (`/favicon.ico`),
  breaking deployments on subdirectory paths like GitHub Pages
  (`base: './'` → `./favicon.ico`).

## [2.0.0] - 2026-02-26

### Added

- `emit` option object for output control:
  - `emit.source` — emit the source file alongside the ICO
    (`boolean | { name?, enabled? }`).
  - `emit.sizes` — emit individual per-size files
    (`true`/`'png'`/`'ico'`/`'both'`).
  - `emit.inject` — auto-inject `<link>` tags into HTML
    (`true`/`'minimal'`/`'full'`);
    strips existing `<link rel="icon">` tags
    while preserving `apple-touch-icon`.
- `sharp` option object for image processing control:
  - `sharp.optimize` — toggle max PNG compression.
  - `sharp.resize` — forward sharp `ResizeOptions` (e.g., `kernel: 'nearest'`
    for pixel art).
  - `sharp.png` — forward sharp `PngOptions` (e.g., `palette: true`, custom
    `compressionLevel`).
- `bun` export condition for direct TypeScript source resolution in Bun.
- Conditional exports (`bun` → `default`) with proper `./package.json` subpath.
- `dev` option for fine-grained dev-server control (`boolean | DevOptions`):
  - `dev: false` disables the serve plugin entirely (build-only mode).
  - `dev: { injection: 'shim' }` injects a runtime script
    that dynamically manages `<link>` tags
    instead of rewriting HTML via `transformIndexHtml` —
    useful for backend-rendered HTML or SPA shells.
  - `dev: { hmr: false }` disables favicon hot-reload on source file changes.
- Non-SVG input support: PNG, JPEG, WebP, AVIF, GIF, and TIFF via sharp format
  detection.
- New `src/html.ts` module with `buildFaviconTags()` pure function and
  `INJECT_ICON_LINK_RE` regex.
- Exported `generateSizedPngs()` and `packIco()` from `ico.ts` for composable
  usage.
- Runtime validation of `emit.sizes`, `emit.inject`, and `dev.injection`
  string values in `configResolved`.
- New type exports: `EmitOptions`, `SharpOptions`, `EmitSizesFormat`,
  `InjectMode`, `DevOptions`, `DevInjection`, `GenerateOptions`.
- `EMIT_SIZES_FORMATS`, `INJECT_MODES`, and `DEV_INJECTIONS` const arrays
  exported.
- Complete JSDoc/TSDoc coverage across all source files.
- Comprehensive test suite: 74 tests covering unit, plugin validation, and
  integration (real Vite builds + dev server).

### Changed

- **BREAKING:** Plugin options restructured from 10 top-level keys to 6 for
  better DX.
- `emit.source` serves correct `Content-Type` for non-SVG inputs (was
  hardcoded to `image/svg+xml`).
- Serve `transformIndexHtml` returns structured `{ html, tags }` instead of
  raw string manipulation.
- `packIco()` signature simplified: accepts `SizedPng[]` instead of separate
  `Buffer[]` + `number[]`.
- `generateSizedPngs()` now accepts a `GenerateOptions` object instead of
  positional args.
- Validation of option string values now derived from const arrays instead
  of duplicated sets.

### Fixed

- HMR `handleHotUpdate`
  compared absolute `file` path to possibly-relative `input`;
  now resolves `input` to absolute via `config.root`.
- `.jpg` and `.tif` extensions produced invalid MIME types
  (`image/jpg`, `image/tif`);
  now normalized to `image/jpeg` and `image/tiff`.
- Empty `sizes: []` now throws instead of producing a degenerate 6-byte ICO.
- Empty `input: ''` now reports "must be a non-empty string"
  instead of misleading "unsupported format" error.
- ICO endpoint fallback now populates per-size cache
  to avoid redundant `generateSizedPngs` calls.

## [1.0.0] - 2026-02-26

### Added

- GitHub Actions workflow for automated npm publishing on version tags.
- npm provenance for supply-chain transparency.
- `publishConfig` with access, provenance, registry, and tag defaults.
- `tar` script for CI tarball packing.
- This changelog.

### Changed

- Switch tsdown to unbundle mode for preserved module structure.
- DCE-only minification for better tree-shaking by consumers (~2 KB smaller).
- Silence `prepack`/`postpack` script output.

## [0.2.0] - 2026-02-26

### Added

- True HMR favicon swap:
  source SVG changes update the browser tab icon in-place
  without a full page reload.
- Injected client-side script listens for the `svg-to-ico:update` custom event
  and swaps every `<link rel="…icon…">` href with a cache-busted URL.
- `transformIndexHtml` hook appends a `?v=` cache-bust param
  to all icon `<link>` tags on initial page load during dev.
- `Cache-Control: no-cache` header on the dev-server ICO middleware
  to prevent stale favicon responses.
- `postpack` npm script to restore `README.md` after `prepack` formatting.
- npm version badge in README.

### Changed

- HMR mechanism replaced:
  `full-reload` dispatch replaced
  with a custom Vite HMR event (`svg-to-ico:update`),
  preserving client-side state across SVG edits.
- README code examples reformatted to match project tab indentation style.

### Fixed

- Browser could serve a stale cached favicon during dev
  even after the ICO was regenerated,
  due to missing cache-control headers and no cache-busting on the `<link>` href.

## [0.1.0] - 2026-02-26

### Added

- SVG-to-ICO conversion using `sharp` for rasterization into PNG-in-ICO format.
- Configurable icon sizes (integers 1-256, default `[16, 32, 48]`)
  with IDE-friendly `IconSize` type autocomplete.
- Optional PNG optimization
  (compression level 9 + adaptive filtering, enabled by default).
- Dev server middleware that serves the generated ICO
  at the configured output path.
- Auto-regeneration when the source SVG changes during development.
- Build-time ICO emission as a Rollup asset.
- `includeSource` option to emit the original SVG alongside the ICO
  (with optional custom filename).
- Input validation for required `input` path and size range constraints.
- Debug timing instrumentation
  via `DEBUG=vite-svg-to-ico` environment variable.
- Three composable sub-plugins (`config`, `serve`, `build`)
  for clean Vite integration.
- Vite 6 and 7 peer dependency compatibility.
- Full TypeScript type exports
  (`PluginOptions`, `IconSize`, `IncludeSourceOptions`).

[Unreleased]: https://github.com/kjanat/vite-svg-to-ico/compare/v4.1.0...HEAD
[4.1.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v3.1.6...v4.0.0
[3.1.6]: https://github.com/kjanat/vite-svg-to-ico/compare/v3.1.5...v3.1.6
[3.1.5]: https://github.com/kjanat/vite-svg-to-ico/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/kjanat/vite-svg-to-ico/compare/v3.1.3...v3.1.4
[3.1.3]: https://github.com/kjanat/vite-svg-to-ico/compare/v3.1.2...v3.1.3
[3.1.2]: https://github.com/kjanat/vite-svg-to-ico/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/kjanat/vite-svg-to-ico/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v2.3.1...v3.0.0
[2.3.1]: https://github.com/kjanat/vite-svg-to-ico/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/kjanat/vite-svg-to-ico/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kjanat/vite-svg-to-ico/releases/tag/v0.1.0

<!-- markdownlint-disable-file MD013 MD024 MD034 -->
