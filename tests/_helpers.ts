/**
 * Shared test utilities.
 *
 * `unwrap` replaces `!` non-null assertions: it throws a clear error at the
 * test site instead of silently dereferencing undefined and producing
 * confusing downstream failures.
 *
 * `invalid` localizes the one place where tests intentionally construct
 * runtime-invalid values to exercise validators — a single internal cast
 * lives here instead of being sprinkled at every call site.
 */

export function unwrap<T>(value: T | null | undefined, msg?: string): T {
	if (value === null || value === undefined) {
		throw new Error(msg ?? 'unwrap: value is null/undefined');
	}
	return value;
}

/**
 * Construct an intentionally type-invalid value for testing runtime
 * validation paths. Use sparingly — only when the test's purpose is to
 * verify a validator rejects shapes that TypeScript would otherwise refuse
 * to construct.
 */
export function invalid<T>(value: unknown): T {
	return value as T;
}
