import { env } from 'node:process';

/**
 * Gate for verbose plugin instrumentation. Set the `DEBUG` env var to
 * `vite-svg-to-ico` to enable per-build timing logs from
 * {@link Instrumentation}; any other value (including unset) keeps the
 * timers silent and zero-overhead.
 */
export const DEBUG = env['DEBUG'] === 'vite-svg-to-ico';

/**
 * Debug-only timing instrumentation.
 *
 * Enable with `DEBUG=vite-svg-to-ico`.
 */
export class Instrumentation {
	private times = new Map<string, number>();

	/** Begin a labeled timer; no-op when {@link DEBUG} is `false`. */
	start(label: string) {
		if (!DEBUG) return;
		this.times.set(label, performance.now());
		console.log(`[svg-to-ico] ${label}...`);
	}

	/** Log elapsed time for a previously started label; no-op when {@link DEBUG} is `false`. */
	end(label: string) {
		if (!DEBUG) return;
		const start = this.times.get(label);
		if (start) {
			const duration = (performance.now() - start).toFixed(2);
			console.log(`[svg-to-ico] ${label} (${duration}ms)`);
		}
	}
}
