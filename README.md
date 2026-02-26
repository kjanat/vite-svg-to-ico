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
	optimize: false,
});
```

### Emit the source SVG alongside the ICO

```ts
svgToIco({
	input: 'src/icon.svg',
	includeSource: true,
});
```

### Emit the source SVG with a custom filename

```ts
svgToIco({
	input: 'src/icon.svg',
	includeSource: { name: 'logo.svg' },
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
	emitSizes: true, // emits favicon-16x16.png, favicon-32x32.png, etc.
});
```

`emitSizes` also accepts `'png'`, `'ico'`, or `'both'` to control the per-size file format:

```ts
svgToIco({
	input: 'src/icon.svg',
	emitSizes: 'both', // emits both .png and .ico per size
});
```

### Auto-inject favicon `<link>` tags

```ts
svgToIco({
	input: 'src/icon.svg',
	includeSource: true,
	inject: true, // injects ICO + SVG <link> tags into HTML
});
```

Use `'full'` to also inject per-size `<link>` tags (requires `emitSizes`):

```ts
svgToIco({
	input: 'src/icon.svg',
	includeSource: true,
	emitSizes: true,
	inject: 'full',
});
```

When `inject` is enabled, existing `<link rel="icon">` and `<link rel="shortcut icon">` tags are stripped from the HTML to prevent duplicates. `apple-touch-icon` tags are preserved.

### Override sharp options

```ts
svgToIco({
	input: 'src/pixel-icon.svg',
	resize: { kernel: 'nearest' }, // crisp pixel art scaling
	png: { palette: true, colours: 64 }, // indexed color output
});
```

The `resize` and `png` objects are merged over sensible defaults — you only need to specify what you want to change. See the [sharp resize](https://sharp.pixelplumbing.com/api-resize) and [sharp PNG](https://sharp.pixelplumbing.com/api-output#png) docs for all available options.

## Options

| Option          | Type                                  | Default                                       | Description                                                            |
| --------------- | ------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| `input`         | `string`                              | **(required)**                                | Path to the source image file (SVG, PNG, JPEG, WebP, AVIF, GIF, TIFF). |
| `output`        | `string`                              | `'favicon.ico'`                               | Output filename for the generated ICO.                                 |
| `sizes`         | `number \| number[]`                  | `[16, 32, 48]`                                | Pixel dimensions to rasterize (1-256).                                 |
| `optimize`      | `boolean`                             | `true`                                        | Max PNG compression (level 9 + adaptive filtering).                    |
| `includeSource` | `boolean \| { name?, enabled? }`      | `false`                                       | Emit the source file alongside the ICO.                                |
| `emitSizes`     | `boolean \| 'png' \| 'ico' \| 'both'` | `false`                                       | Emit individual per-size files alongside the combined ICO.             |
| `inject`        | `boolean \| 'minimal' \| 'full'`      | `false`                                       | Inject `<link>` tags for generated favicons into `index.html`.         |
| `resize`        | `sharp.ResizeOptions`                 | `{ fit: 'contain', background: transparent }` | Sharp resize options (width/height set automatically per size).        |
| `png`           | `sharp.PngOptions`                    | Derived from `optimize`                       | Sharp PNG output options. Explicit values override `optimize`.         |

### `emitSizes` details

| Value    | Emitted per-size files                        |
| -------- | --------------------------------------------- |
| `true`   | `favicon-{W}x{H}.png`                         |
| `'png'`  | `favicon-{W}x{H}.png` (same as `true`)        |
| `'ico'`  | `favicon-{W}x{H}.ico`                         |
| `'both'` | `favicon-{W}x{H}.png` + `favicon-{W}x{H}.ico` |

### `inject` details

| Value       | Tags injected                                       |
| ----------- | --------------------------------------------------- |
| `true`      | ICO + SVG source (if SVG input + `includeSource`)   |
| `'minimal'` | Same as `true`                                      |
| `'full'`    | Minimal + per-size file tags (requires `emitSizes`) |

## How it works

- **Build**: reads the source image, rasterizes it to PNG at each size via `sharp`, packs the PNGs into an ICO container (PNG-in-ICO format), and emits it as a Rollup asset.
- **Dev**: pre-generates the ICO on server start and serves it via middleware. When the source file changes, the ICO is regenerated and the browser favicon is swapped in-place via HMR (no page reload).

## Debug

Set `DEBUG=vite-svg-to-ico` to enable timing instrumentation.

## License

[MIT](https://github.com/kjanat/vite-svg-to-ico/blob/master/LICENSE)

<!--markdownlint-disable-file no-hard-tabs-->
