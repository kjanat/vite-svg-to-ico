# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `emitSizes` option to emit individual per-size files (`true`/`'png'`/`'ico'`/`'both'`) alongside the combined ICO.
- `inject` option to auto-inject `<link>` tags into HTML (`true`/`'minimal'`/`'full'`); strips existing `<link rel="icon">` tags while preserving `apple-touch-icon`.
- Non-SVG input support: PNG, JPEG, WebP, AVIF, GIF, and TIFF via sharp format detection.
- New `src/html.ts` module with `buildFaviconTags()` pure function and `INJECT_ICON_LINK_RE` regex.
- Exported `generateSizedPngs()` and `packIco()` from `ico.ts` for composable usage.
- Runtime validation of `emitSizes` and `inject` string values in `configResolved`.
- New type exports: `EmitSizesFormat`, `InjectMode`.

### Changed

- `includeSource` serves correct `Content-Type` for non-SVG inputs (was hardcoded to `image/svg+xml`).
- Serve `transformIndexHtml` returns structured `{ html, tags }` instead of raw string manipulation.
- `packIco()` signature simplified: accepts `SizedPng[]` instead of separate `Buffer[]` + `number[]`.

### Fixed

- HMR `handleHotUpdate` compared absolute `file` path to possibly-relative `input`; now resolves `input` to absolute via `config.root`.
- `.jpg` and `.tif` extensions produced invalid MIME types (`image/jpg`, `image/tif`); now normalized to `image/jpeg` and `image/tiff`.

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

- True HMR favicon swap: source SVG changes update the browser tab icon in-place without a full page reload.
- Injected client-side script listens for the `svg-to-ico:update` custom event and swaps every `<link rel="…icon…">` href with a cache-busted URL.
- `transformIndexHtml` hook appends a `?v=` cache-bust param to all icon `<link>` tags on initial page load during dev.
- `Cache-Control: no-cache` header on the dev-server ICO middleware to prevent stale favicon responses.
- `postpack` npm script to restore `README.md` after `prepack` formatting.
- npm version badge in README.

### Changed

- HMR mechanism replaced: `full-reload` dispatch replaced with a custom Vite HMR event (`svg-to-ico:update`), preserving client-side state across SVG edits.
- README code examples reformatted to match project tab indentation style.

### Fixed

- Browser could serve a stale cached favicon during dev even after the ICO was regenerated, due to missing cache-control headers and no cache-busting on the `<link>` href.

## [0.1.0] - 2026-02-26

### Added

- SVG-to-ICO conversion using `sharp` for rasterization into PNG-in-ICO format.
- Configurable icon sizes (integers 1-256, default `[16, 32, 48]`) with IDE-friendly `IconSize` type autocomplete.
- Optional PNG optimization (compression level 9 + adaptive filtering, enabled by default).
- Dev server middleware that serves the generated ICO at the configured output path.
- Auto-regeneration when the source SVG changes during development.
- Build-time ICO emission as a Rollup asset.
- `includeSource` option to emit the original SVG alongside the ICO (with optional custom filename).
- Input validation for required `input` path and size range constraints.
- Debug timing instrumentation via `DEBUG=vite-svg-to-ico` environment variable.
- Three composable sub-plugins (`config`, `serve`, `build`) for clean Vite integration.
- Vite 6 and 7 peer dependency compatibility.
- Full TypeScript type exports (`PluginOptions`, `IconSize`, `IncludeSourceOptions`).

[Unreleased]: https://github.com/kjanat/vite-svg-to-ico/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/kjanat/vite-svg-to-ico/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kjanat/vite-svg-to-ico/releases/tag/v0.1.0
