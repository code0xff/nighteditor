/**
 * 알림을 화면 오른쪽 위에 띄운다 (spec §4).
 *
 * 배너로 두면 뜰 때마다 본문이 아래로 밀린다. 알림 하나 떴다고 읽던 자리가 움직이면
 * 안 된다. 띄우는 자리를 문서 위로 옮겨 흐름을 건드리지 않는다.
 *
 * **할 일이 딸린 알림은 여기로 오지 않는다.** 자동으로 사라지면 버튼도 함께 사라지므로,
 * 자원을 못 붙였다는 안내는 배너로 남는다 (`ui/App.tsx`).
 */
import { useEffect } from 'react';
import { IconClose, IconLocked, IconNotice } from '@/lib/icons';
import { useI18n } from '@/store/locale';
import { useToasts, type Toast } from '@/store/toasts';
import { cn } from '@/lib/utils';

/** 읽는 데 걸리는 시간만큼만. 오류는 스스로 사라지지 않는다 */
const LINGER = 4000;

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-3 top-14 z-50 flex w-80 flex-col gap-2"
      // 알림은 읽던 것을 끊지 않고 전해져야 한다.
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
    // 오류는 놔둔다. 3초 만에 사라지면 못 본 사람은 저장된 줄 안다.
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
