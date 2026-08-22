import { decodeHTML, escapeAttribute, escapeText } from 'entities';

/**
 * INV-8 · Compare after decoding, save after encoding.
 *
 * Entity handling lives in this module only. We do not implement it ourselves —
 * there are over 2000 named entities, and a hand-rolled substitution table is
 * guaranteed to be wrong somewhere.
 */

/** Entities in the source string to actual characters (for the live comparison) */
export function decode(html: string): string {
  return decodeHTML(html);
}

/** User input into a form that can be written into the source — entity-encode `&`, `<`, `>` */
export function encode(text: string): string {
  return escapeText(text);
}

/**
 * A decoded value into a form that can be written back into an attribute position.
 *
 * Attribute values from the parser arrive with entities already resolved (`&quot;` → `"`).
 * Written back as-is into the source's attribute position, a quote terminates the value
 * early and the rest parses as a new attribute. We cannot know here which quote style
 * (or none) wrapped that position, so we entity-encode everything that is unsafe in any
 * style — both quotes, whitespace, and `<>=\`` . Character references are valid in all
 * three styles, and the browser resolves them back to the same value.
 */
export function encodeAttribute(text: string): string {
  return escapeAttribute(text).replace(/['<>=`\t\n\f\r ]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * The **minimal** encoding a browser uses for attribute values when serializing
 * innerHTML — `&`, `"`, NBSP.
 *
 * The conservative spelling we send out via `encodeAttribute` comes back rewritten
 * into this spelling after a round trip through the browser. To reverse the returned
 * value (ADR-011) we must hold this spelling's counterpart, not just the one we sent.
 */
export function encodeAttributeSerialized(text: string): string {
  return escapeAttribute(text);
}

/**
 * The **original spelling** into a form safe for the serialized context (the
 * double-quoted attributes innerHTML produces).
 *
 * Re-encoding the decoded value (`encodeAttributeSerialized`) collapses non-standard
 * source entities (`&#32;` etc.) into the minimal spelling, changing the spelling of an
 * attribute the user never touched (Principle 2). Character-reference resolution does
 * not depend on quote style, so keep the source bytes as they are and entity-encode
 * only the one character that terminates a double-quoted value early: `"`. It can
 * appear raw only in single-quoted or unquoted source, and resolves to the same value
 * once through the parser.
 */
export function requoteAttribute(raw: string): string {
  return raw.replace(/"/g, '&quot;');
}

/** Normalization for text comparison that ignores whitespace differences */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
