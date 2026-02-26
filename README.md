# vite-svg-to-ico

[![npm](https://img.shields.io/npm/v/vite-svg-to-ico)](https://www.npmjs.com/package/vite-svg-to-ico)

Vite plugin that converts an SVG file into a multi-size `.ico` favicon at build time. Serves the generated ICO during development with HMR support.

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

## Options

| Option          | Type                             | Default         | Description                                         |
| --------------- | -------------------------------- | --------------- | --------------------------------------------------- |
| `input`         | `string`                         | **(required)**  | Path to the source SVG file.                        |
| `output`        | `string`                         | `'favicon.ico'` | Output filename for the generated ICO.              |
| `sizes`         | `number \| number[]`             | `[16, 32, 48]`  | Pixel dimensions to rasterize (1-256).              |
| `optimize`      | `boolean`                        | `true`          | Max PNG compression (level 9 + adaptive filtering). |
| `includeSource` | `boolean \| { name?, enabled? }` | `false`         | Emit the source SVG alongside the ICO.              |

## How it works

- **Build**: reads the SVG, rasterizes it to PNG at each size via `sharp`, packs the PNGs into an ICO container (PNG-in-ICO format), and emits it as a Rollup asset.
- **Dev**: pre-generates the ICO on server start and serves it via middleware. When the source SVG changes, the ICO is regenerated and the browser favicon is swapped in-place via HMR (no page reload).

## Debug

Set `DEBUG=vite-svg-to-ico` to enable timing instrumentation.

## License

[MIT](https://github.com/kjanat/vite-svg-to-ico/blob/master/LICENSE)

<!--markdownlint-disable-file no-hard-tabs-->
