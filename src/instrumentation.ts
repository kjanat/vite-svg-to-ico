const DEBUG = process.env.DEBUG === 'vite-svg-to-ico';

export { DEBUG };

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
