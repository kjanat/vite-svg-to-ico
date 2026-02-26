const DEBUG = process.env.DEBUG === 'vite-svg-to-ico';

export { DEBUG };

/**
 * Debug-only timing instrumentation. Uses explicit resource management
 * (`using`) to auto-clear timers when the block scope exits.
 *
 * Enable with `DEBUG=vite-svg-to-ico`.
 */
export class Instrumentation implements Disposable {
	private times = new Map<string, number>();

	/** Begin a labeled timer; no-op when {@link DEBUG} is `false`. */
	start(label: string) {
		if (!DEBUG) return;
		this.times.set(label, performance.now());
		console.log(`[@vite:svg-to-ico] ${label}...`);
	}

	/** Log elapsed time for a previously started label; no-op when {@link DEBUG} is `false`. */
	end(label: string) {
		if (!DEBUG) return;
		const start = this.times.get(label);
		if (start) {
			const duration = (performance.now() - start).toFixed(2);
			console.log(`[@vite:svg-to-ico] ${label} (${duration}ms)`);
		}
	}

	[Symbol.dispose](): void {
		this.times.clear();
	}
}
