import { useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import { useReplacement } from '@/store/replacement';
import { FLUSH_TIMEOUT, registerPreviewFlush, shortcutSave } from '@/store/unsaved';
import { useI18n } from '@/store/locale';
import { cn } from '@/lib/utils';
import { FORMAT_LABELS } from '@/lib/messages';
import type { FromPreview, ToPreview } from '@/preview/protocol';

/** A fresh number per flush request — a late reply to an old request must not release a new one */
let flushSerial = 0;

/**
 * Renders the artifact and talks to the preview agent by postMessage only (rules §4).
 *
 * `sandbox` gets allow-same-origin and allow-scripts together. As a sandbox the
 * combination is toothless, but the target is the user's own local file and
 * there is no server, so we accept it (ADR-006).
 */
export function PreviewFrame() {
  const frame = useRef<HTMLIFrameElement>(null);
  const { t } = useI18n();
  const previewDoc = useEditor((s) => s.previewDoc);
  const previewToken = useEditor((s) => s.previewToken);
  const blocks = useEditor((s) => s.blocks);
  const scanned = useEditor((s) => s.scanned);
  const onReady = useEditor((s) => s.onReady);
  const onEdit = useEditor((s) => s.onEdit);
  const onBlocked = useEditor((s) => s.onBlocked);
  const onNotReady = useEditor((s) => s.onNotReady);
  const select = useEditor((s) => s.select);
  const downloadCopy = useEditor((s) => s.downloadCopy);
  const undoLast = useEditor((s) => s.undoLast);
  const revertQueue = useEditor((s) => s.revertQueue);
  const drainReverts = useEditor((s) => s.drainReverts);
  const revealId = useEditor((s) => s.revealId);
  const drainReveal = useEditor((s) => s.drainReveal);
  // All screen locking during replacement derives from the single reservation state (ADR-010).
  const replacing = useReplacement((s) => s.replacing);
  /**
   * Where the preview's commit replies (flushed) are awaited — one per request
   * number (spec §4). Each entry's lifetime ends through its single settle —
   * whichever comes first (reply, timeout, unmount) clears the timer, removes
   * the entry, and resolves the promise in the same place.
   */
  const flushWaiters = useRef(new Map<number, () => void>());

  // Register the function that asks the preview "if editing now, commit and
  // tell me" (spec §4). The prompt side (keepEdits) knows nothing about the
  // iframe, so the wiring happens here.
  useEffect(() => {
    const waiters = flushWaiters.current;
    const unregister = registerPreviewFlush(
      () =>
        new Promise<void>((resolve) => {
          const win = frame.current?.contentWindow;
          // No preview means no edit to commit — resolve right away.
          if (!win) {
            resolve();
            return;
          }
          const seq = ++flushSerial;
          // The requesting side's race (flushPreviewEdits) already enforces
          // the timeout, but that race knows nothing of this map — facing an
          // unresponsive preview, timed-out entries would linger until unmount
          // and pile up with every request. Each entry cleans itself up on the
          // same timeout.
          const settle = (): void => {
            clearTimeout(timer);
            waiters.delete(seq);
            resolve();
          };
          const timer = setTimeout(settle, FLUSH_TIMEOUT);
          waiters.set(seq, settle);
          const msg: ToPreview = { type: 'flush', seq };
          win.postMessage(msg, '*');
        })
    );
    return () => {
      unregister();
      // An unmounting screen can deliver no more replies — settle every
      // remaining wait now. settle removes itself from the map, so iterate
      // over a copy.
      for (const settle of [...waiters.values()]) settle();
    };
  }, []);

  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const msg = e.data as FromPreview | null;
      if (!msg || typeof msg !== 'object') return;
      // Drop messages from the old preview that arrive after switching
      // (spec §5) — the iframe is reused and swapping srcDoc keeps the
      // contentWindow identity, so they pass the source check, yet block ids
      // restart at 0 in every document, letting the old document's content and
      // locks touch the new one.
      if ((msg.token ?? '') !== previewToken) return;
      if (msg.type === 'ready') onReady(msg.blocks);
      else if (msg.type === 'edit') onEdit(msg.id, msg.html, msg.pristine);
      else if (msg.type === 'blocked') onBlocked(msg.id);
      else if (msg.type === 'notReady') onNotReady();
      else if (msg.type === 'select') select(msg.id);
      // Ctrl+S pressed inside the preview. The host window never sees that key
      // (spec §4). It takes the same path as the host's shortcut — with the
      // save prompt up, it means "save and continue".
      else if (msg.type === 'save') shortcutSave();
      else if (msg.type === 'downloadCopy') downloadCopy();
      else if (msg.type === 'undo') undoLast();
      // The reply to a flush request — the commit (edit) came first on the same
      // channel, so a prompt released here reads an unsaved that already knows
      // that edit (spec §4). Replies from old previews are filtered by the
      // token check above, and their requests are cleaned up by the entry's
      // timeout timer. settle finishes timer, map entry, and resolution in one
      // step — a late reply to a request already timed out and cleaned up
      // passes by quietly.
      else if (msg.type === 'flushed') flushWaiters.current.get(msg.seq)?.();
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [previewToken, onReady, onEdit, onBlocked, onNotReady, select, downloadCopy, undoLast]);

  // Hand over the labels for the formatting bar. The agent cannot load the
  // language pack (ADR-007). Resend on language change so a bar already on
  // screen changes with it.
  //
  // A send right after the document switches can vanish — the new iframe has
  // not run the agent yet. So send again after the agent's ready ends
  // verification (scanned) — only then is the listener certainly attached
  // (spec §4.1).
  useEffect(() => {
    const labels: Record<string, string> = {};
    for (const key of FORMAT_LABELS) labels[key] = t(key);
    const msg: ToPreview = { type: 'labels', labels };
    frame.current?.contentWindow?.postMessage(msg, '*');
  }, [t, previewDoc, scanned]);

  // Tell the preview once verification ends and the locks are final. Blocking
  // in the UI alone is not enough (INV-5). Every real block id (all) goes
  // along — the document can mimic data-ne-id, and the agent does not count
  // markers missing from this roster as blocks (spec §3).
  useEffect(() => {
    if (!scanned) return;
    const ids = blocks.filter((b) => b.locked !== null).map((b) => b.id);
    const msg: ToPreview = { type: 'locked', ids, all: blocks.map((b) => b.id) };
    frame.current?.contentWindow?.postMessage(msg, '*');
  }, [scanned, blocks]);

  // Reverts must reach the preview too. Deleting only the patch leaves the edited content on screen.
  useEffect(() => {
    if (revertQueue.length === 0) return;
    for (const item of revertQueue) {
      const msg: ToPreview = { type: 'revert', id: item.id, html: item.html };
      frame.current?.contentWindow?.postMessage(msg, '*');
    }
    drainReverts();
  }, [revertQueue, drainReverts]);

  // Show the block picked in the change list. The list alone makes it hard to tell where the edit is.
  useEffect(() => {
    if (revealId === null) return;
    const msg: ToPreview = { type: 'reveal', id: revealId };
    frame.current?.contentWindow?.postMessage(msg, '*');
    drainReveal();
  }, [revealId, drainReveal]);

  if (!previewDoc) return null;

  return (
    <iframe
      ref={frame}
      title={t('preview.title')}
      // Lock the preview while replacing — the previous document is still on
      // screen, but an edit started here has nowhere to go once the new
      // document stands (spec §4). Commits that get through anyway (blur of an
      // already-open block, etc.) are rejected by the store's onEdit.
      className={cn('h-full w-full border-0 bg-white', replacing && 'pointer-events-none')}
      sandbox="allow-scripts allow-same-origin"
      srcDoc={previewDoc}
    />
  );
}
