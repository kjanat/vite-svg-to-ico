# vite-svg-to-ico

[![NPM Version](https://img.shields.io/npm/v/vite-svg-to-ico?logo=npm&labelColor=CB3837&color=black)](https://npm.im/package/vite-svg-to-ico)

Vite plugin that converts an image file into a multi-size `.ico` favicon at
build time.\
Serves the generated ICO during development with HMR support.

## Install

```sh
npm install -D vite-svg-to-ico
```

Requires [`sharp`](https://sharp.pixelplumbing.com/) as a runtime dependency (installed automatically).

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import svgToIco from 'vite-svg-to-ico';

export default defineConfig({
  plugins: [svgToIco({ input: 'src/icon.svg' })],
});
```

### Custom sizes and output filename

```ts
svgToIco({
  input: 'src/logo.svg',
  output: 'icon.ico',
  sizes: [16, 24, 32, 48, 64, 128, 256],
});
```

### Skip PNG optimization for faster builds

```ts
svgToIco({
  input: 'src/icon.svg',
  sharp: { optimize: false },
});
```

### The `emit` array

Since v3, `emit` is an **array of per-format specs**.
Each entry produces one or more output files
and optionally a `<link>` tag in the page `<head>`.
Pick the formats and sizes you want — combine freely.

```ts
svgToIco({
  input: 'src/icon.svg',
  emit: [
    { format: 'ico', sizes: [16, 32, 48], inject: true },
    { format: 'png', sizes: [192, 512], inject: { sizes: [192] } },
    { format: 'svg', filename: 'logo.svg', inject: true },
  ],
});
```

What the example does:

- Emits one combined `favicon.ico` containing the 16/32/48 PNG layers,
  and injects `<link rel="icon" type="image/x-icon" sizes="16x16 32x32 48x48">`.
- Emits `favicon-192x192.png` and `favicon-512x512.png` standalone files.
  Injects a `<link rel="icon" type="image/png" sizes="192x192">`
  for the 192 only (per `inject: { sizes: [192] }`); the 512 is on disk
  but not referenced in HTML.
- Emits `logo.svg` (a copy of the source) and injects
  `<link rel="icon" type="image/svg+xml" sizes="any">`.

Common patterns:

```ts
// Just a combined favicon.ico (matches the default — `emit` may be omitted).
// `filename` is omitted, so the spec falls back to `opts.output ?? 'favicon.ico'`.
emit: [{ format: 'ico', sizes: [16, 32, 48] }];

// Multiple separate ICOs for legacy tooling that expects favicon-NxN.ico.
emit: [
  { format: 'ico', sizes: [16, 32, 48] },
  { format: 'ico', sizes: [16], filename: 'favicon-16x16.ico' },
  { format: 'ico', sizes: [32], filename: 'favicon-32x32.ico' },
];

// ICO + SVG source for modern browsers (SVG takes precedence when supported).
emit: [
  { format: 'ico', sizes: [16, 32, 48], inject: true },
  { format: 'svg', inject: true },
];
```

When any spec has `inject: true`, the plugin strips existing
`<link rel="icon">` and `<link rel="shortcut icon">` tags
from the HTML before injecting the new set,
to prevent duplicates. `apple-touch-icon` tags are preserved.

### Embedding as `data:` URIs

`inject: 'embed'` inlines the favicon bytes directly into the `<link>` href as a
`data:` URI — the HTML carries the image itself, no file reference. Pair it with
`emit: false` to embed without writing a file at all.

```ts
svgToIco({
  input: 'src/icon.svg',
  emit: [
    // ICO inlined as base64 AND written to disk (default emit: true).
    { format: 'ico', sizes: [16, 32], inject: 'embed' },
    // SVG inlined as a utf8 data: URI, no file on disk.
    { format: 'svg', emit: false, inject: 'embed', encoding: 'utf8' },
  ],
});
```

Encoding (`SvgSpec` only): `base64` (default) is opaque and uniform; `utf8`
(`data:image/svg+xml,…`) keeps the markup readable and is usually smaller. The
SVG bytes are preserved verbatim — quotes and significant whitespace (including
CDATA and `xml:space="preserve"`) survive the round-trip unchanged. Binary ICO
and PNG are always base64. Embedded hrefs are never cache-busted, since the href
_is_ the content.

### Non-SVG input

PNG, JPEG, WebP, AVIF, GIF, and TIFF sources are supported — the plugin detects
format from the file extension:

```ts
svgToIco({
  input: 'src/logo.png',
  emit: [{ format: 'ico', sizes: [16, 32, 48] }],
});
```

Note: a `{ format: 'svg' }` spec only emits something when the input is an SVG.
For raster inputs, the spec is silently no-ops in the source-copy step.

### Remote / URL input

`input` also accepts `http(s)://` and `file://` URLs (string or `URL`
instance). Remote sources are fetched once per build and cached; HMR only
watches local paths.

```ts
svgToIco({ input: 'https://example.com/icon.svg' });
```

```sh
# globally installed
svg-to-ico generate https://example.com/icon.svg --out-dir build

# one-off via npx (no install)
npx -y --package=vite-svg-to-ico svg-to-ico generate https://example.com/icon.svg --out-dir build
```

### Migrating from the v2 `emit` shape

The `{ source, sizes, inject }` object shape was **removed in v4** — `emit`
now accepts only an `EmitSpec[]` array. Convert as follows:

| v2 (removed)                                | v3/v4                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `emit: { source: true }`                    | `emit: [{ format: 'ico' }, { format: 'svg' }]`                                                  |
| `emit: { sizes: 'png' }`                    | `emit: [{ format: 'ico' }, { format: 'png', sizes: [16, 32, 48] }]`                             |
| `emit: { source: true, inject: 'minimal' }` | `emit: [{ format: 'ico', inject: true }, { format: 'svg', inject: true }]`                      |
| `emit: { sizes: 'both', inject: 'full' }`   | One ICO spec + per-size PNG/ICO specs, all with `inject: true` (see CHANGELOG migration guide). |

### Framework integration (SvelteKit, VitePress, Astro adapters)

SvelteKit, VitePress, and some Astro adapters render their HTML
**outside** Vite's pipeline, so `transformIndexHtml` never fires and
`emit.inject` produces no tags. The build plugin detects this
and emits a warning, but the fix lives outside the plugin.

Two options:

**1. Configure tags at the framework level.** Use SvelteKit's
`app.html`, VitePress's `head` config, or Astro's `<Head>` slot. The
plugin still emits the ICO/SVG files — only the tag injection moves to
the framework.

**2. Use the bundled `svg-to-ico` CLI as a `postbuild` step.** The CLI
rewrites HTML files on disk after the framework's adapter finishes
writing them. Useful when you want a single source of truth for the
icon sizes and don't want to duplicate them in framework config.

```json
{
  "scripts": {
    "build": "vite build && svg-to-ico inject build/index.html build/404.html --sizes 16 --sizes 32 --sizes 48 --source favicon.svg"
  }
}
```

The CLI is **not Vite-specific** — it ships with this package as a
convenience but works against any HTML and any image source. Install
the package globally (`bun i -g vite-svg-to-ico`, `npm i -g vite-svg-to-ico`) to
get the `svg-to-ico` command on your PATH for use in non-Vite
pipelines, one-off CI scripts, or other framework toolchains:

```sh
svg-to-ico generate src/icon.svg --out-dir build --sizes 16 --sizes 32 --sizes 48 --emit-source --emit-sizes png
svg-to-ico inject build/index.html --sizes 16 --sizes 32 --sizes 48 --source icon.svg
```

Run `svg-to-ico --help` for the full surface.

### Override sharp options

```ts
svgToIco({
  input: 'src/pixel-icon.svg',
  sharp: {
    resize: { kernel: 'nearest' }, // crisp pixel art scaling
    png: { palette: true, colours: 64 }, // indexed color output
  },
});
```

The `sharp.resize` and `sharp.png` objects are merged over sensible defaults —
you only need to specify what you want to change. See the
[sharp resize](https://sharp.pixelplumbing.com/api-resize) and
[sharp PNG](https://sharp.pixelplumbing.com/api-output#png) docs for all
available options.

### Dev server control

```ts
// Disable dev server entirely (build-only)
svgToIco({ input: 'src/icon.svg', dev: false });

// Use runtime shim instead of HTML transform for favicon injection
svgToIco({ input: 'src/icon.svg', dev: { injection: 'shim' } });

// Disable HMR favicon refresh
svgToIco({ input: 'src/icon.svg', dev: { hmr: false } });
```

## Options

| Option   | Type                    | Default               | Description                                                                 |
| -------- | ----------------------- | --------------------- | --------------------------------------------------------------------------- |
| `input`  | `string \| URL`         | **(required)**        | Source image: path, `URL` instance, or `file://` / `http(s)://` URL string. |
| `sizes`  | `number \| number[]`    | `[16, 32, 48]`        | Default sizes used when an `IcoSpec` omits its own `sizes`.                 |
| `emit`   | `EmitSpec[]`            | `[{ format: 'ico' }]` | What to emit and inject — an array of per-format specs.                     |
| `output` | `string`                | `'favicon.ico'`       | Fallback ICO filename when an `IcoSpec` omits `filename`.                   |
| `sharp`  | `SharpOptions`          | `{}`                  | Sharp image processing options.                                             |
| `dev`    | `boolean \| DevOptions` | `true`                | Control dev-server behavior.                                                |

### `emit` (v3 — recommended)

Array of per-format specs. Each entry is one of:

#### `IcoSpec`

| Field      | Type                 | Default           | Description                                                              |
| ---------- | -------------------- | ----------------- | ------------------------------------------------------------------------ |
| `format`   | `'ico'`              | —                 | Discriminator.                                                           |
| `sizes`    | `number[]?`          | Top-level `sizes` | Sizes to pack into this ICO (1–256).                                     |
| `filename` | `string?`            | `'favicon.ico'`   | Output filename (relative to build output).                              |
| `emit`     | `boolean?`           | `true`            | Write the ICO file. Set `false` to embed without writing (see `inject`). |
| `inject`   | `boolean \| 'embed'` | `false`           | `true` links the file; `'embed'` inlines the bytes as a `data:` URI.     |

#### `PngSpec`

| Field              | Type                                       | Default                       | Description                                                                        |
| ------------------ | ------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| `format`           | `'png'`                                    | —                             | Discriminator.                                                                     |
| `sizes`            | `number[]`                                 | **(required)**                | Sizes to emit as separate PNG files (1–4096 — not bound by ICO's 256 cap).         |
| `filenameTemplate` | `string?`                                  | `'favicon-{size}x{size}.png'` | Template using `{size}` placeholder.                                               |
| `emit`             | `boolean?`                                 | `true`                        | Write the PNG files. Set `false` to embed without writing.                         |
| `inject`           | `boolean \| 'embed' \| { sizes?, embed? }` | `false`                       | `true` links all sizes; `'embed'` inlines all; `{ sizes }` / `{ embed }` scope it. |

#### `SvgSpec`

| Field      | Type                 | Default           | Description                                                                         |
| ---------- | -------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `format`   | `'svg'`              | —                 | Discriminator.                                                                      |
| `filename` | `string?`            | `basename(input)` | Output filename (only meaningful when input is an SVG).                             |
| `emit`     | `boolean?`           | `true`            | Write the SVG copy. Set `false` to embed without writing.                           |
| `inject`   | `boolean \| 'embed'` | `false`           | `true` links the file; `'embed'` inlines the SVG as a `data:` URI.                  |
| `encoding` | `'base64' \| 'utf8'` | `'base64'`        | Embed encoding (only with `inject: 'embed'`). `utf8` is readable + usually smaller. |

### `emit` (v2 — deprecated, removed in v4)

| Field    | Type                                  | Default | Description                                                     |
| -------- | ------------------------------------- | ------- | --------------------------------------------------------------- |
| `source` | `boolean \| { name?, enabled? }`      | `false` | Emit the source file alongside the ICO.                         |
| `sizes`  | `boolean \| 'png' \| 'ico' \| 'both'` | `false` | Emit individual per-size files.                                 |
| `inject` | `boolean \| 'minimal' \| 'full'`      | `false` | Inject `<link>` tags. `'full'` requires `sizes` to also be set. |

### `sharp`

| Option     | Type                  | Default                                       | Description                                             |
| ---------- | --------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `optimize` | `boolean`             | `true`                                        | Max PNG compression (level 9 + adaptive filtering).     |
| `resize`   | `sharp.ResizeOptions` | `{ fit: 'contain', background: transparent }` | Sharp resize options (width/height set per size).       |
| `png`      | `sharp.PngOptions`    | Derived from `optimize`                       | Sharp PNG options. Explicit values override `optimize`. |

### `dev`

| Option      | Type                    | Default       | Description                                    |
| ----------- | ----------------------- | ------------- | ---------------------------------------------- |
| `enabled`   | `boolean`               | `true`        | Enable dev-server features entirely.           |
| `injection` | `'transform' \| 'shim'` | `'transform'` | How favicon tags are added during dev.         |
| `hmr`       | `boolean`               | `true`        | Auto-refresh favicon when source file changes. |

## How it works

- **Build**: reads the source image, rasterizes it to PNG at each size via
  `sharp`, packs the PNGs into an ICO container (PNG-in-ICO format), and emits
  it as a Rollup asset.
- **Dev**: pre-generates the ICO on server start and serves it via middleware.
  When the source file changes, the ICO is regenerated and the browser favicon
  is swapped in-place via HMR (no page reload).

## Debug

Set `DEBUG=vite-svg-to-ico` to enable timing instrumentation.

## License

[MIT](https://github.com/kjanat/vite-svg-to-ico/blob/master/LICENSE)
