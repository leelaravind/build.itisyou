/**
 * Evidence artefact storage.
 *
 * Contract: gap-spec §35 (randomised keys, no user-controlled path, content-disposition safety),
 * §32 (a recorded content hash is what makes a record evidence rather than testimony).
 *
 * The bucket itself is only reachable inside a Workers runtime, so what is tested here is everything
 * that decides *what* is written and *how it comes back* — the parts where a mistake is a security
 * defect rather than an outage.
 */

import { describe, expect, it } from 'vitest';
import { hashBytes, safeDownloadName } from '../../src/lib/server/evidence-storage.ts';

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

describe('the content hash', () => {
  it('is SHA-256 in lowercase hex', async () => {
    // The published digest of the empty input, so this pins the algorithm rather than the code's
    // agreement with itself.
    expect(await hashBytes(new ArrayBuffer(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the well-known digest of "abc"', async () => {
    expect(await hashBytes(bytesOf('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('changes when a single byte changes', async () => {
    /*
     * The property the whole feature rests on. A record whose hash does not move when the artefact
     * does is a record that cannot tell a swapped file from the original, which is the difference
     * between evidence and testimony.
     */
    expect(await hashBytes(bytesOf('rollback rehearsed in 13 seconds'))).not.toBe(
      await hashBytes(bytesOf('rollback rehearsed in 14 seconds')),
    );
  });
});

describe('the download filename', () => {
  it('is built from the label rather than from the uploaded name', () => {
    expect(safeDownloadName('Rollback rehearsal log', '.txt')).toBe('rollback-rehearsal-log.txt');
  });

  it('cannot end the header and start another one', () => {
    /*
     * The §35 attack. A filename carrying a quote closes the `filename="…"` value; one carrying a
     * newline ends the header entirely and begins whatever follows. Escaping user text into a
     * header is a game of catch-up, so the name is constructed from a restricted alphabet instead.
     */
    const name = safeDownloadName('a"; \r\nSet-Cookie: session=stolen', '.pdf');

    expect(name).not.toContain('"');
    expect(name).not.toContain('\r');
    expect(name).not.toContain('\n');
    expect(name).not.toContain(';');
    expect(name.toLowerCase()).not.toContain('set-cookie:');
  });

  it('cannot escape a directory', () => {
    const name = safeDownloadName('../../etc/passwd', '.txt');

    expect(name).not.toContain('..');
    expect(name).not.toContain('/');
  });

  it('never produces a bare extension when the label reduces to nothing', () => {
    // A label of only punctuation would otherwise yield ".pdf", which some clients treat as a
    // hidden file and others as no filename at all.
    expect(safeDownloadName('!!!', '.pdf')).toBe('evidence.pdf');
    expect(safeDownloadName('', '.pdf')).toBe('evidence.pdf');
  });

  it('bounds the length', () => {
    const name = safeDownloadName('word '.repeat(200), '.txt');
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it('takes the extension from the stored type, not from the label', () => {
    /*
     * A label ending in ".html" must not produce an `.html` download of a file the allowlist
     * accepted as something else — the extension comes from the MIME type that was checked.
     */
    expect(safeDownloadName('report.html', '.pdf')).toBe('report-html.pdf');
  });
});
