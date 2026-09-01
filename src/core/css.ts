/**
 * The `url()` tokenizer — rewriting what a stylesheet points at (spec §5.1).
 *
 * CSS is not HTML, and parse5 cannot see inside a stylesheet. Attached
 * stylesheets and `<style>` bodies reference assets of their own, and reaching
 * them means walking the text: skipping strings and comments whole, and touching
 * only the `url(` that stands at a token boundary.
 *
 * Substitution results are **preview only** — the source string is never
 * rewritten (Principle 1 · ADR-009).
 */
import { blobSuffix, resolvePath, splitSuffix, type Resolve } from './paths.js';

/** The end of a quoted string (past the closing quote). Skips escapes */
function endOfString(css: string, at: number): number {
  const quote = css[at];
  let i = at + 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i++;
  }
  return css.length;
}

/**
 * Decodes CSS escapes (CSS Syntax §4.3.7).
 *
 * The path in `url(my\ file.png)` is `my file.png` — undecoded, the bundle key is
 * looked up backslash and all, counting a file that really sits there as missing.
 * A hex escape includes the one whitespace character that follows it (`\61 b` is
 * `ab`).
 */
function decodeCssEscapes(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '\\') {
      out += text[i];
      i++;
      continue;
    }
    const hex = /^[0-9a-f]{1,6}/i.exec(text.slice(i + 1, i + 7));
    if (hex) {
      const code = parseInt(hex[0], 16);
      // Per spec, 0, surrogates, and out-of-range are U+FFFD — do not fabricate characters.
      out +=
        code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
          ? '�'
          : String.fromCodePoint(code);
      i += 1 + hex[0].length;
      // One whitespace character after the hex is part of the escape. CRLF counts as one unit.
      if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
      else if (/[ \t\n\r\f]/.test(text[i] ?? '')) i++;
      continue;
    }
    // A newline after `\` is a line continuation inside a string — it leaves no character.
    if (/[\n\r\f]/.test(text[i + 1] ?? '')) {
      i += text[i + 1] === '\r' && text[i + 2] === '\n' ? 3 : 2;
      continue;
    }
    // Any other `\X` is X itself. A lone trailing `\` stays as written.
    out += text[i + 1] ?? '\\';
    i += 2;
  }
  return out;
}

/**
 * CSS-escapes the fragment being written back. Writing the decoded value as-is
 * lets quotes, parentheses, and whitespace break the `url()` token — lock only
 * those characters as hex. The whitespace appended after the hex is part of the
 * escape, so it cannot fuse with the next character.
 */
function encodeCssValue(text: string): string {
  return text.replace(/[\s"'()\\]/g, (c) => `\\${(c.codePointAt(0) ?? 0).toString(16)} `);
}

/** Tears out everything from after `url(` to the closing paren. The value itself may be quoted */
function readUrl(css: string, at: number): { value: string; quote: string; end: number } | null {
  let i = at;
  while (i < css.length && /\s/.test(css[i] ?? '')) i++;

  const quote = css[i] === '"' || css[i] === "'" ? (css[i] as string) : '';
  if (quote) {
    const close = endOfString(css, i);
    const value = decodeCssEscapes(css.slice(i + 1, close - 1));
    let j = close;
    while (j < css.length && /\s/.test(css[j] ?? '')) j++;
    return css[j] === ')' ? { value, quote, end: j + 1 } : null;
  }

  // An unquoted url token ends at an **unescaped** `)`. Searching with indexOf
  // cuts `url(foo\)bar.png)` at the escaped paren and looks up a nonexistent path.
  let j = i;
  while (j < css.length && css[j] !== ')') j += css[j] === '\\' ? 2 : 1;
  if (j >= css.length) return null;
  return { value: decodeCssEscapes(css.slice(i, j).trim()), quote: '', end: j + 1 };
}

/**
 * Rewrites `url(...)` inside CSS.
 *
 * A blob URL has no directory. Attaching only the stylesheet without rewriting
 * these leaves the fonts inside with no base, so they all break. `@import` is left
 * alone (spec §5.1).
 *
 * Strings and comments are skipped whole. `content: "url(icon.png)"` is not a
 * function pointing at an asset but **characters printed on screen**. Changing it
 * creates characters that were never there.
 */
export function rewriteCssUrls(css: string, baseDir: string, resolve: Resolve): string {
  let out = '';
  let i = 0;

  while (i < css.length) {
    const ch = css[i] ?? '';

    if (ch === '"' || ch === "'") {
      const end = endOfString(css, i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      const end = close < 0 ? css.length : close + 2;
      out += css.slice(i, end);
      i = end;
      continue;
    }
    // Only url( after a token boundary is the function. Rewriting mid-identifier
    // cuts up someone else's function name like `--icon: myurl(x)` into
    // `myurl(blob:...)` — changing a value that is not an asset.
    if (
      css.slice(i, i + 4).toLowerCase() === 'url(' &&
      !/[-\w\u0080-\uffff]/.test(css[i - 1] ?? '')
    ) {
      const token = readUrl(css, i + 4);
      const path = token ? resolvePath(baseDir, token.value) : null;
      const url = path === null ? undefined : resolve(path);
      if (token && url) {
        const { suffix } = splitSuffix(token.value.trim());
        // The fragment is the escape-decoded value — lock only the token-breaking
        // characters again when writing back.
        out += `url(${token.quote}${url}${encodeCssValue(blobSuffix(suffix))}${token.quote})`;
        i = token.end;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/** Collects only the asset paths CSS points at — for counting what could not be attached */
export function cssAssetPaths(css: string, baseDir: string): string[] {
  const paths: string[] = [];
  rewriteCssUrls(css, baseDir, (path) => {
    paths.push(path);
    return undefined;
  });
  return paths;
}
