import { defineConfig } from 'vite';
import svgToIco from 'vite-svg-to-ico';

/** Mirrors the README's flagship example: combined ICO 16/32/48, PNG at 192 + 512 with only 192 injected,
 * SVG fallback renamed to logo.svg. */
export default defineConfig({
	logLevel: 'silent',
	plugins: [
		svgToIco({
			input: 'src/icon.svg',
			emit: [
				{ format: 'ico', sizes: [16, 32, 48], inject: true },
				{ format: 'png', sizes: [192, 512], inject: { sizes: [192] } },
				{ format: 'svg', filename: 'logo.svg', inject: true },
			],
		}),
	],
});
