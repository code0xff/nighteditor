/**
 * The guard for unsaved edits.
 *
 * Until saved, this tool's edits exist only in memory. Closing the tab or opening
 * another file loses them for good, so we always ask before they can disappear.
 */

/**
 * Makes the browser confirm tab close and reload while there are unsaved changes.
 *
 * The wording is the browser's own — pages have long been unable to supply the message.
 *
 * @param hasChanges whether there are unsaved changes right now. Asked anew on every event
 * @returns a function that removes the listener
 */
export function onBeforeUnload(hasChanges: () => boolean): () => void {
  const onUnload = (e: BeforeUnloadEvent) => {
    if (!hasChanges()) return;
    // Both are needed. Different browsers look at different ones.
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onUnload);
  return () => window.removeEventListener('beforeunload', onUnload);
}
