import { describe, expect, it } from 'vitest';
import { dirOf, resolvePath } from './paths.js';

describe('resolvePath', () => {
  it('resolves against the document location', () => {
    expect(resolvePath('', 'deck.css')).toBe('deck.css');
    expect(resolvePath('slides', 'deck.css')).toBe('slides/deck.css');
    expect(resolvePath('slides/2026', '../deck.css')).toBe('slides/deck.css');
    expect(resolvePath('slides', './img/logo.png')).toBe('slides/img/logo.png');
  });

  it('absolute paths resolve against the bundle root', () => {
    expect(resolvePath('slides/2026', '/assets/deck.css')).toBe('assets/deck.css');
  });

  it('leaves outward references alone', () => {
    // Either the browser can already fetch them, or they are not assets at all.
    for (const url of [
      'https://cdn.example.com/a.css',
      '//cdn.example.com/a.css',
      'data:image/png;base64,AAAA',
      'blob:https://example.com/x',
      'mailto:um@kdccy.com',
      '#section',
      '',
      '   ',
    ]) {
      expect(resolvePath('', url)).toBeNull();
    }
  });

  it('strips query strings and anchors', () => {
    expect(resolvePath('', 'deck.css?v=3')).toBe('deck.css');
    expect(resolvePath('', 'sprite.svg#icon')).toBe('sprite.svg');
  });

  it('turns percent-encoding back into the real file name', () => {
    // The bundle key is the name on disk, not the spelling in the document.
    expect(resolvePath('', 'my%20deck.css')).toBe('my deck.css');
  });

  it('collapses encoded dot segments as dots too (spec §5.1)', () => {
    // The URL spec collapses %2e segments as dot segments. Decoding after collapsing
    // leaves deck/sub's %2e%2e/logo.png as deck/sub/../logo.png, counting the
    // deck/logo.png that really sits there as missing.
    expect(resolvePath('deck/sub', '%2e%2e/logo.png')).toBe('deck/logo.png');
    expect(resolvePath('deck/sub', '%2E%2E/logo.png')).toBe('deck/logo.png');
    expect(resolvePath('deck/sub', '%2e/logo.png')).toBe('deck/sub/logo.png');
  });

  it('leaves badly encoded segments written as-is and decodes the rest', () => {
    // Decoding the whole string and failing would leave even healthy segments in
    // their spelling — decode segment by segment.
    expect(resolvePath('', '100%/my%20deck.css')).toBe('100%/my deck.css');
  });

  it('does not decode %2F inside a segment into a separator (spec §5.1)', () => {
    // A file name on disk cannot contain a slash — decoded, part of the name turns
    // into a path separator, and the nonexistent a/b.png is looked up instead of the
    // real file a%2Fb.png.
    expect(resolvePath('', 'a%2Fb.png')).toBe('a%2Fb.png');
    // Its spelling (case) stays as written — the bundle key is the name on disk.
    expect(resolvePath('', 'a%2fb.png')).toBe('a%2fb.png');
    // Other encodings in the same segment still decode.
    expect(resolvePath('', 'img/a%2Fb%20c.png')).toBe('img/a%2Fb c.png');
    // The %25 of %252F decodes to % — not to %2F itself.
    expect(resolvePath('', 'a%252Fb.png')).toBe('a%2Fb.png');
  });

  it('does not escape past the root', () => {
    expect(resolvePath('', '../../etc/passwd')).toBe('etc/passwd');
  });
});

describe('dirOf', () => {
  it('gives the directory the document sits in', () => {
    expect(dirOf('slides/deck.html')).toBe('slides');
    expect(dirOf('deck.html')).toBe('');
  });
});
