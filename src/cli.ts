#!/usr/bin/env node
/**
 * # svg-to-ico
 *
 * CLI companion to the `vite-svg-to-ico` Vite plugin.
 * Generates multi-size ICO favicons from any sharp-supported source image,
 * and/or injects favicon `<link>` tags into existing HTML files.
 *
 * ## Why
 *
 * Vite's plugin pipeline ends at `closeBundle`. Frameworks that render HTML
 * outside that pipeline (SvelteKit, VitePress, Astro adapters) write the user-
 * visible HTML *after* the plugin's last hook fires, so the plugin's built-in
 * `emit.inject` silently no-ops. This CLI runs as a `"postbuild"` step against
 * the framework's final on-disk HTML, sidestepping the hook-ordering trap.
 *
 * The CLI is also useful for non-Vite pipelines: a one-off ICO generator that
 * shares the plugin's emit logic (sharp + ICO packer) without dragging Vite
 * into the equation. Global install with `bun i -g vite-svg-to-ico` (or
 * `npm i -g vite-svg-to-ico`) puts `svg-to-ico` on PATH.
 *
 * ## Subcommands
 *
 * - `generate <input>` — rasterize an image to a multi-size ICO (and
 *   optionally per-size PNGs/ICOs + a copy of the source) on disk.
 * - `inject <files...>` — rewrite existing HTML files: strip
 *   `<link rel="icon">`/`<link rel="shortcut icon">` tags, splice the
 *   configured favicon tag set before `</head>`, preserve `apple-touch-icon`.
 *
 * @example
 * ```sh
 * # SvelteKit adapter-static, wired into package.json scripts:
 * #   "build": "vite build && svg-to-ico inject build/index.html build/404.html -s 16 -s 32 -s 48 --source favicon.svg"
 *
 * # Generate a 16/32/48 ICO + per-size PNGs alongside it:
 * svg-to-ico generate src/icon.svg --out-dir build -s 16 -s 32 -s 48 --emit-sizes png --emit-source
 *
 * # Inject favicon links into multiple HTML files at once:
 * svg-to-ico inject dist/index.html dist/404.html -s 16 -s 32 -s 48 --source favicon.svg --base /app/
 * ```
 */

import { blue } from '#cli/colors';
import { generate } from '#cli/commands/generate';
import { inject } from '#cli/commands/inject';
import { cli } from '@kjanat/dreamcli';

/**
 * Top-level `svg-to-ico` CLI: bundles {@link generate} and {@link inject}
 * subcommands plus shell-completion generation.
 */
export const app = cli('svg-to-ico')
  .manifest({ from: import.meta.url })
  .links()
  .description(`Generate ICO favicons and inject ${blue('<link>')} tags into HTML files`)
  .command(generate)
  .command(inject)
  .completions();

if (import.meta.main) {
  void app.run();
}
