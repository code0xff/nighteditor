import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import {
  injectAgentScript,
  injectEditorStyle,
  injectMarkers,
  LOCKED_ATTR,
  MARKER_ATTR,
  MarkerError,
} from './markers.js';
import { fixtureSource } from '../__fixtures__/load.js';

const source = fixtureSource();
const blocks = parseBlocks(source);

describe('injectMarkers', () => {
  const injected = injectMarkers(source, blocks);

  it('attaches a marker to every block', () => {
    const found = injected.match(new RegExp(`${MARKER_ATTR}="\\d+"`, 'g'));
    expect(found).toHaveLength(blocks.length);
  });

  it('does not mutate the source (INV-1)', () => {
    expect(source).toBe(fixtureSource());
  });

  it('block structure and text stay the same with markers injected', () => {
    const after = parseBlocks(injected);
    expect(after).toHaveLength(blocks.length);
    expect(after.map((b) => b.sourceText)).toEqual(blocks.map((b) => b.sourceText));
    expect(after.map((b) => b.tag)).toEqual(blocks.map((b) => b.tag));
  });

  it('marker ids match block ids', () => {
    for (const b of blocks) {
      expect(injected).toContain(`${MARKER_ATTR}="${b.id}"`);
    }
  });

  it('attaches to locked blocks too — the UI must show the lock reason', () => {
    const locked = blocks.filter((b) => b.locked !== null);
    expect(locked.length).toBeGreaterThan(0);
    for (const b of locked) expect(injected).toContain(`${MARKER_ATTR}="${b.id}"`);
  });

  it('fails instead of silently skipping when the opening tag end cannot be found', () => {
    const bogus = [{ ...blocks[0]!, innerStart: 0 }];
    expect(() => injectMarkers(source, bogus)).toThrow(MarkerError);
  });

  it('markers are preview-only, so save-path offsets are unaffected (INV-3)', () => {
    // The injected copy grows, but offsets against the source stay valid.
    expect(injected.length).toBeGreaterThan(source.length);
    for (const b of blocks) {
      expect(source.slice(b.innerStart, b.innerEnd)).toBe(b.sourceInner);
    }
  });
});

describe('injectAgentScript (ADR-007)', () => {
  const agent = 'function agent(){ console.log("hi") }';

  it('the agent comes before the artifact scripts', () => {
    const out = injectAgentScript(source, agent);
    // The injection point is the correctness condition. Coming after flips the
    // listener registration order, so the artifact's global handlers cannot be blocked.
    expect(out.indexOf('function agent()')).toBeLessThan(out.indexOf('addEventListener'));
  });

  it('inserts right after <head>', () => {
    const out = injectAgentScript(
      '<html><head><title>t</title></head><body>b</body></html>',
      agent
    );
    expect(out).toContain('<head><script>(function agent()');
  });

  it('inserts after <html> when there is no head', () => {
    const out = injectAgentScript('<html><body>b</body></html>', agent);
    expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('<body>'));
  });

  it('carries the document token as the agent argument (spec §5)', () => {
    const out = injectAgentScript('<html><head></head></html>', agent, 'doc-3');
    expect(out).toContain(')("doc-3");</script>');
  });

  it('escapes < in the token — a </script shape must not cut the inline script', () => {
    const out = injectAgentScript('<html><head></head></html>', agent, '</script>');
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });

  it('a </script> inside the agent does not cut the inline script', () => {
    const out = injectAgentScript(
      '<html><head></head></html>',
      'function a(){ var s = "</script>" }'
    );
    expect(out).toContain('<\\/script>');
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });

  it('source offsets stay valid when combined with marker injection (INV-3)', () => {
    const preview = injectAgentScript(injectMarkers(source, blocks), agent);
    expect(preview).toContain(`${MARKER_ATTR}="0"`);
    for (const b of blocks) {
      expect(source.slice(b.innerStart, b.innerEnd)).toBe(b.sourceInner);
    }
  });
});

describe('injectEditorStyle', () => {
  const styled = injectEditorStyle(source);

  it('inserts a single chunk at the front of <head> — the fixture has a <style> of its own', () => {
    const head = /<head[^>]*>/i.exec(source);
    expect(styled.indexOf('<style>')).toBe((head?.index ?? 0) + (head?.[0].length ?? 0));
    // Exactly one copy of the injected rules. Counted by the variable block that
    // opens them — counting rule occurrences instead would have to be retuned
    // every time a rule is added, which says nothing about being injected twice.
    expect(styled.match(new RegExp(`\\[${MARKER_ATTR}\\]\\{--ne-mark`, 'g'))).toHaveLength(1);
  });

  it('uses the marker and lock marks as selectors — mismatched names mean no display', () => {
    const style = /<style>(.*?)<\/style>/s.exec(styled)?.[1] ?? '';
    expect(style).toContain(`[${MARKER_ATTR}]`);
    expect(style).toContain(`[${LOCKED_ATTR}]`);
  });

  it('locked blocks are excluded from the editable display', () => {
    const style = /<style>(.*?)<\/style>/s.exec(styled)?.[1] ?? '';
    expect(style).toContain(`[${MARKER_ATTR}]:not([${LOCKED_ATTR}]):hover`);
  });

  it('uses no layout-shaking properties — the document must not shift', () => {
    const style = /<style>(.*?)<\/style>/s.exec(styled)?.[1] ?? '';
    for (const forbidden of ['border', 'margin', 'padding', 'font', 'display', 'position']) {
      expect(style, forbidden).not.toContain(forbidden);
    }
  });

  it('prepends to the document when there is no head', () => {
    expect(injectEditorStyle('<p>본문</p>').startsWith('<style>')).toBe(true);
  });

  it('the variable definitions the marks read do not lose to artifact CSS either', () => {
    // This style is injected before the artifact CSS. Without !important on the
    // variable definitions, one line like [data-ne-id]{--ne-soft:transparent}
    // wipes out the hover/edit/reveal outlines entirely — the outlines protected
    // by !important read their values from those variables.
    const style = /<style>(.*?)<\/style>/s.exec(styled)?.[1] ?? '';
    for (const name of ['--ne-mark', '--ne-soft', '--ne-tint']) {
      const declarations = style.match(new RegExp(`${name}:[^;}]*`, 'g')) ?? [];
      // Both sets: for light backgrounds and for dark ones.
      expect(declarations.length).toBeGreaterThanOrEqual(2);
      for (const declaration of declarations) expect(declaration).toContain('!important');
    }
  });

  it('does not touch the source string block offsets (INV-3)', () => {
    // Injection is preview-only. The save path always starts from the source.
    const after = parseBlocks(injectEditorStyle(injectMarkers(source, blocks)));
    expect(after.map((b) => b.sourceText)).toEqual(blocks.map((b) => b.sourceText));
    expect(source).toBe(fixtureSource());
  });
});
