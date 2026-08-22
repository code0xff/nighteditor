/** Why a block cannot be edited. null means editable. (docs/spec.md §3) */
export type LockReason =
  'RAW_TEXT' | 'SCRIPT_GENERATED' | 'EMPTY_IN_SOURCE' | 'CODE_BLOCK' | 'AMBIGUOUS' | 'MARKER_CLASH';

/**
 * The unit of editing. Every offset is relative to the **source string** (INV-3).
 * innerStart..innerEnd runs from just after the opening tag to just before the closing tag.
 */
export interface Block {
  id: number;
  tag: string;
  innerStart: number;
  innerEnd: number;
  /** The original innerHTML verbatim (entities included) */
  sourceInner: string;
  /** Text with tags stripped and entities decoded. For the live comparison (INV-8) */
  sourceText: string;
  /** RCDATA — tags cannot go inside, so plain text only (spec §2.1) */
  rcdata: boolean;
  locked: LockReason | null;
}

/** The result of a user edit. On save, the block's inner range is replaced with this value. */
export interface Patch {
  id: number;
  newInnerHtml: string;
}
