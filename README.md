# vite-svg-to-ico

[![npm](https://img.shields.io/npm/v/vite-svg-to-ico)](https://www.npmjs.com/package/vite-svg-to-ico)

Vite plugin that converts an image file into a multi-size `.ico` favicon at build time.\
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
	plugins: [
		svgToIco({ input: 'src/icon.svg' }),
	],
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

### Emit the source SVG alongside the ICO

```ts
svgToIco({
	input: 'src/icon.svg',
	emit: { source: true },
});
```

### Emit the source SVG with a custom filename

```ts
svgToIco({
	input: 'src/icon.svg',
	emit: { source: { name: 'logo.svg' } },
});
```

### Non-SVG input

PNG, JPEG, WebP, AVIF, GIF, and TIFF sources are supported — the plugin detects format from the file extension:

```ts
svgToIco({
	input: 'src/logo.png',
});
```

### Emit individual per-size files

```ts
svgToIco({
	input: 'src/icon.svg',
	emit: { sizes: true }, // emits favicon-16x16.png, favicon-32x32.png, etc.
});
```

`emit.sizes` also accepts `'png'`, `'ico'`, or `'both'` to control the per-size file format:

```ts
svgToIco({
	input: 'src/icon.svg',
	emit: { sizes: 'both' }, // emits both .png and .ico per size
});
```

### Auto-inject favicon `<link>` tags

```ts
svgToIco({
	input: 'src/icon.svg',
	emit: { source: true, inject: true }, // injects ICO + SVG <link> tags into HTML
});
```

Use `'full'` to also inject per-size `<link>` tags (requires `emit.sizes`):

```ts
svgToIco({
	input: 'src/icon.svg',
	emit: { source: true, sizes: true, inject: 'full' },
});
```

When `emit.inject` is enabled, existing `<link rel="icon">` and `<link rel="shortcut icon">` tags are stripped from the HTML to prevent duplicates. `apple-touch-icon` tags are preserved.

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

The `sharp.resize` and `sharp.png` objects are merged over sensible defaults — you only need to specify what you want to change. See the [sharp resize](https://sharp.pixelplumbing.com/api-resize) and [sharp PNG](https://sharp.pixelplumbing.com/api-output#png) docs for all available options.

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

| Option  | Type                          | Default          | Description                                          |
| ------- | ----------------------------- | ---------------- | ---------------------------------------------------- |
| `input` | `string`                      | **(required)**   | Path to source image (SVG, PNG, JPEG, WebP, etc.).   |
| `output` | `string`                     | `'favicon.ico'`  | Output filename for the generated ICO.               |
| `sizes` | `number \| number[]`          | `[16, 32, 48]`  | Pixel dimensions to rasterize (1–256).               |
| `emit`  | `EmitOptions`                 | `{}`             | Control emitted files and HTML injection.            |
| `sharp` | `SharpOptions`                | `{}`             | Sharp image processing options.                      |
| `dev`   | `boolean \| DevOptions`       | `true`           | Control dev-server behavior.                         |

### `emit`

| Option   | Type                                   | Default  | Description                                            |
| -------- | -------------------------------------- | -------- | ------------------------------------------------------ |
| `source` | `boolean \| { name?, enabled? }`       | `false`  | Emit the source file alongside the ICO.                |
| `sizes`  | `boolean \| 'png' \| 'ico' \| 'both'` | `false`  | Emit individual per-size files.                        |
| `inject` | `boolean \| 'minimal' \| 'full'`       | `false`  | Inject `<link>` tags into `index.html`.                |

#### `emit.sizes` details

| Value    | Emitted per-size files                         |
| -------- | ---------------------------------------------- |
| `true`   | `favicon-{W}x{H}.png`                         |
| `'png'`  | `favicon-{W}x{H}.png` (same as `true`)        |
| `'ico'`  | `favicon-{W}x{H}.ico`                         |
| `'both'` | `favicon-{W}x{H}.png` + `favicon-{W}x{H}.ico` |

#### `emit.inject` details

| Value       | Tags injected                                      |
| ----------- | -------------------------------------------------- |
| `true`      | ICO + SVG source (if SVG input + `emit.source`)    |
| `'minimal'` | Same as `true`                                     |
| `'full'`    | Minimal + per-size file tags (requires `emit.sizes`) |

### `sharp`

| Option     | Type                  | Default                                       | Description                                              |
| ---------- | --------------------- | --------------------------------------------- | -------------------------------------------------------- |
| `optimize` | `boolean`             | `true`                                        | Max PNG compression (level 9 + adaptive filtering).      |
| `resize`   | `sharp.ResizeOptions` | `{ fit: 'contain', background: transparent }` | Sharp resize options (width/height set per size).        |
| `png`      | `sharp.PngOptions`    | Derived from `optimize`                       | Sharp PNG options. Explicit values override `optimize`.  |

### `dev`

| Option      | Type                        | Default       | Description                                          |
| ----------- | --------------------------- | ------------- | ---------------------------------------------------- |
| `enabled`   | `boolean`                   | `true`        | Enable dev-server features entirely.                 |
| `injection` | `'transform' \| 'shim'`    | `'transform'` | How favicon tags are added during dev.               |
| `hmr`       | `boolean`                   | `true`        | Auto-refresh favicon when source file changes.       |

## How it works

- **Build**: reads the source image, rasterizes it to PNG at each size via `sharp`, packs the PNGs into an ICO container (PNG-in-ICO format), and emits it as a Rollup asset.
- **Dev**: pre-generates the ICO on server start and serves it via middleware. When the source file changes, the ICO is regenerated and the browser favicon is swapped in-place via HMR (no page reload).

## Debug

Set `DEBUG=vite-svg-to-ico` to enable timing instrumentation.

## License

[MIT](https://github.com/kjanat/vite-svg-to-ico/blob/master/LICENSE)

<!--markdownlint-disable-file no-hard-tabs-->
