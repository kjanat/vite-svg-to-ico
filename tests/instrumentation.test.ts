import { describe, expect, it, jest, beforeEach, afterEach } from 'bun:test';

import { Instrumentation } from '../src/instrumentation.ts';

describe('Instrumentation', () => {
	// Note: DEBUG is evaluated at module load time from process.env.DEBUG
	// We test the class behavior directly

	it('start and end do not throw', () => {
		const inst = new Instrumentation();
		expect(() => inst.start('test')).not.toThrow();
		expect(() => inst.end('test')).not.toThrow();
	});

	it('end for unknown label does not throw', () => {
		const inst = new Instrumentation();
		expect(() => inst.end('nonexistent')).not.toThrow();
	});
});
