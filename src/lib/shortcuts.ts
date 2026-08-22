/**
 * Keyboard shortcuts for the host window. Keys pressed inside the preview (iframe)
 * never reach here, so the agent intercepts them separately and forwards a message
 * (ADR-007, spec §4).
 *
 * The combo checks live both here and in the agent. The agent is injected as a
 * stringified function, so code cannot be shared — when changing a combo, change
 * both places together.
 */

export interface EditorShortcuts {
  /** Ctrl+S · ⌘S */
  save: () => void;
  /** Ctrl+Shift+S · ⌘⇧S */
  downloadCopy: () => void;
  /** Ctrl+Z · ⌘Z — revert the most recently committed change */
  undo: () => void;
}

/**
 * Shortcuts are not intercepted inside text fields.
 * Ctrl+Z pressed while fixing the title must be that field's own undo — it must
 * not revert some other block.
 */
function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Captures the save and download-a-copy shortcuts. Blocks the browser's own
 * "save page" dialog.
 *
 * @returns a function that removes the listener
 */
export function onEditorShortcuts({ save, downloadCopy, undo }: EditorShortcuts): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (e.shiftKey) downloadCopy();
      else save();
      return;
    }

    // Undo steps aside in text fields. Save does not — saving is saving wherever it is pressed.
    if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey && !inTextField(e.target)) {
      e.preventDefault();
      undo();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
