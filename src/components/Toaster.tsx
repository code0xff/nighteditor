/**
 * Floats notices at the top right of the screen (spec §4).
 *
 * As a banner, every notice would push the content down. One notice must not
 * move the spot the user was reading. Floating above the document leaves the
 * flow untouched.
 *
 * **Notices that carry an action never come here.** Auto-dismissal would take
 * the button with it, so the missing-assets notice stays a banner (`ui/App.tsx`).
 */
import { useEffect } from 'react';
import { IconClose, IconLocked, IconNotice } from '@/lib/icons';
import { useI18n } from '@/store/locale';
import { useToasts, type Toast } from '@/store/toasts';
import { cn } from '@/lib/utils';

/** Just long enough to read. Errors never dismiss themselves */
const LINGER = 4000;

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-3 top-14 z-50 flex w-80 flex-col gap-2"
      // Notices must be delivered without interrupting what is being read.
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.key} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const { tn, t } = useI18n();

  useEffect(() => {
    // Leave errors alone. Gone in three seconds, whoever missed it assumes the save succeeded.
    if (toast.tone === 'error') return;
    const timer = setTimeout(() => dismiss(toast.key), LINGER);
    return () => clearTimeout(timer);
  }, [toast.key, toast.tone, dismiss]);

  const Icon = toast.tone === 'locked' ? IconLocked : IconNotice;

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-md border bg-card p-2.5 shadow-lg',
        toast.tone === 'error' ? 'border-destructive' : 'border-border'
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-xs">{tn(toast.notice)}</p>
      <button
        type="button"
        onClick={() => dismiss(toast.key)}
        aria-label={t('toast.dismiss')}
        title={t('toast.dismiss')}
        className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
      >
        <IconClose className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
