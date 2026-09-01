import { describe, expect, it } from 'vitest';
import { sign, unsign } from '../../src/lib/server/signed-cookie.ts';

/**
 * Cookie signing.
 *
 * `SESSION_SECRET` has been mandatory in every deployed environment since Phase 1 and signed nothing.
 * Its comment in `packages/shared/src/env.ts` said *"Signing key for guest session cookies"*, which
 * described a mechanism that did not exist.
 *
 * These tests exist because the failure mode of a signing bug is silence: a broken `unsign` that
 * returns the value regardless would pass every functional test in the suite, because every
 * functional test presents a cookie this process just signed.
 */

describe('sign and unsign', () => {
  it('round-trips a value', () => {
    expect(unsign(sign('abc-123'))).toBe('abc-123');
  });

  it('round-trips a value containing the separator', () => {
    /*
     * The separator is a dot and a UUID contains none — but the parser splits on the *last* dot
     * rather than the first, so a value that contains one still round-trips. Pinned because the
     * obvious implementation splits on the first and silently truncates every such value.
     */
    expect(unsign(sign('one.two.three'))).toBe('one.two.three');
  });

  it('rejects a value whose signature has been changed', () => {
    const signed = sign('session-id');
    const tampered = `${signed.slice(0, -1)}${signed.endsWith('A') ? 'B' : 'A'}`;

    expect(unsign(tampered)).toBeUndefined();
  });

  it('rejects a value that has been changed while keeping the signature', () => {
    // The attack the signature exists for: reuse a valid signature with a different id.
    const signed = sign('session-a');
    const signature = signed.slice(signed.lastIndexOf('.'));

    expect(unsign(`session-b${signature}`)).toBeUndefined();
  });

  it('rejects an unsigned value', () => {
    // What every cookie issued before signing existed looks like. It must resolve to no session
    // rather than to a session, so the holder is issued a fresh one.
    expect(unsign('session-id')).toBeUndefined();
  });

  it('rejects a value with an empty signature', () => {
    expect(unsign('session-id.')).toBeUndefined();
  });

  it('rejects a signature that is not valid base64url', () => {
    expect(unsign('session-id.!!!!not base64!!!!')).toBeUndefined();
  });

  it('rejects a bare separator and an empty string', () => {
    // `lastIndexOf` returns 0 for a leading separator, which would otherwise sign the empty string.
    expect(unsign('.')).toBeUndefined();
    expect(unsign('')).toBeUndefined();
    expect(unsign('.signature')).toBeUndefined();
  });

  it('rejects undefined, which is the no-cookie case', () => {
    expect(unsign(undefined)).toBeUndefined();
  });

  it('rejects a signature of the wrong length without throwing', () => {
    /*
     * `timingSafeEqual` throws on a length mismatch rather than returning false. If the length check
     * were removed, a short signature would produce a 500 instead of a rejection — turning a forged
     * cookie into a denial of service.
     */
    expect(() => unsign('session-id.AAAA')).not.toThrow();
    expect(unsign('session-id.AAAA')).toBeUndefined();
  });

  it('produces different signatures for different values', () => {
    const a = sign('a');
    const b = sign('b');

    expect(a.slice(a.lastIndexOf('.'))).not.toBe(b.slice(b.lastIndexOf('.')));
  });

  it('is deterministic for the same value', () => {
    // The cookie is set once and read on every subsequent request. A non-deterministic signature
    // would log everybody out on their second request.
    expect(sign('stable')).toBe(sign('stable'));
  });
});
