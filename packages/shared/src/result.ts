/**
 * Result type for operations whose failure is an expected outcome rather than an exception.
 *
 * Used primarily by the AI-import validation pipeline (plan section 11.1), where a rejection is a
 * normal, first-class result the user must see - not an error condition. Throwing there would be
 * wrong: an invalid AI response is the system working correctly.
 *
 * Exceptions remain the right tool for genuinely exceptional conditions (a lost database
 * connection). This type is for the cases where "it failed" is part of the domain.
 */

export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Collect many results into one.
 *
 * Accumulates *all* errors rather than stopping at the first. The AI-import validator must show the
 * user every problem in their pasted response at once - returning them one at a time would force a
 * round trip to an external AI per error, which is a miserable loop to be stuck in.
 */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }
  return errors.length > 0 ? err(errors) : ok(values);
}
