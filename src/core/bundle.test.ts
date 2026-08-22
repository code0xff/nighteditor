import { describe, expect, it } from 'vitest';
import { documentCandidates, pickDocument } from './bundle.js';

describe('pickDocument', () => {
  it('picks the document on the surface of the bundle', () => {
    // A deeply buried document is usually a part. The one on the surface is the bundle's face.
    expect(pickDocument(['deck/parts/a.html', 'deck.html'])).toBe('deck.html');
  });

  it('prefers index at the same depth', () => {
    expect(pickDocument(['deck/zzz.html', 'deck/index.html'])).toBe('deck/index.html');
  });

  it('non-HTML files are not candidates', () => {
    expect(pickDocument(['deck/style.css', 'deck/logo.svg'])).toBeNull();
  });

  it('does not look inside hidden folders', () => {
    expect(pickDocument(['.git/x.html', 'deck.html'])).toBe('deck.html');
    expect(pickDocument(['.cache/x.html'])).toBeNull();
  });

  it('.htm is a document too', () => {
    expect(pickDocument(['old.htm'])).toBe('old.htm');
  });

  it('returns all candidates in order — we must be able to say how many the pick came from', () => {
    // Instead of silently picking one, we must be able to state the pick (Principle 3).
    expect(documentCandidates(['b/deep.html', 'a.html', 'z.html'])).toEqual([
      'a.html',
      'z.html',
      'b/deep.html',
    ]);
  });

  it('the order does not depend on the arrival order', () => {
    const paths = ['deck/index.html', 'deck/appendix.html', 'readme.html'];

    expect(pickDocument(paths)).toBe(pickDocument([...paths].reverse()));
  });
});
