/**
 * CSS media queries, read from JavaScript.
 *
 * The layout itself belongs in CSS. This is for the cases where the answer
 * changes behavior rather than appearance: what is reachable by tab, and which
 * sentence is true on this device.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setMatches(mq.matches);
    // The window may have changed between the first render and this effect.
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** A finger, not a mouse pointer — the device cannot hover, and cannot drag a file onto a window. */
export const TOUCH = '(pointer: coarse)';

/** Tailwind's `md` — from here the toolbar has room for more than actions. */
export const MD = '(min-width: 768px)';
