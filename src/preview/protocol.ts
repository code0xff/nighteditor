/**
 * The message contract between host (editor) and preview (iframe).
 *
 * **This is a type-only module.** No values or functions live here — runtime
 * code would make preview and ui share code, breaking rules §4.
 * Types alone leave nothing behind after compilation, so the two bundles stay
 * separate.
 */

/** Preview → host. Every message carries the document's token — see below */
export type FromPreview = {
  /**
   * This preview document's token. The iframe is reused, and swapping `srcDoc`
   * keeps the `contentWindow` identity, so an old document's messages pass the
   * source check — the host drops any message whose token is not the current
   * document's (spec §5). Only a token-less agent (tests) omits this field.
   */
  token?: string;
} & FromPreviewBody;

type FromPreviewBody =
  | { type: 'ready'; blocks: { id: number; text: string }[] }
  | { type: 'select'; id: number | null }
  /** pristine means the edit result equals the original content — the host deletes the patch */
  | { type: 'edit'; id: number; html: string; pristine: boolean }
  | { type: 'blocked'; id: number }
  /** A block was clicked before verification finished — no edit was opened, and the host explains why (spec §4) */
  | { type: 'notReady' }
  /**
   * The reply to the host's flush request (spec §4) — it means "every pending
   * commit has been sent". The open edit's commit (edit) is sent **first**, so
   * if this reply arrived, that commit already arrived too — the same channel
   * preserves order. If composition deferred the commit, the reply is deferred
   * with it and sent after the deferred commit goes out or the edit is dropped.
   */
  | { type: 'flushed'; seq: number }
  /** Ctrl+S was pressed inside the preview. Key events in the iframe never reach the host window */
  | { type: 'save' }
  /** Ctrl+Shift+S — leave the original alone and download only the result */
  | { type: 'downloadCopy' }
  /** Ctrl+Z outside editing — undo the last committed change */
  | { type: 'undo' };

/** Host → preview */
export type ToPreview =
  /**
   * Verification finished. `ids` are the locked blocks; `all` is **every** real
   * block id. The document can mimic `data-ne-id` (spec §3), so the agent does
   * not count markers missing from the roster as blocks — without it, editing
   * would open on an impostor element and its commit, belonging to no block,
   * would vanish silently.
   */
  | { type: 'locked'; ids: number[]; all: number[] }
  /**
   * Commit the open edit now (spec §4). Sent before anything that would lose
   * edits (close, open, switch) asks its question — the preview's commit
   * (focusout) travels by postMessage and can land after the host's `unsaved`
   * check. The agent sends the commit, then replies flushed with the same `seq`.
   */
  | { type: 'flush'; seq: number }
  | { type: 'revert'; id: number; html: string }
  /** Show the block picked in the change list (scroll + brief highlight) */
  | { type: 'reveal'; id: number }
  /**
   * Labels for the formatting bar. The agent cannot load the language pack
   * (ADR-007), so the host hands them over — screen text always has one
   * source: the language pack (spec §1).
   */
  | { type: 'labels'; labels: Record<string, string> };
