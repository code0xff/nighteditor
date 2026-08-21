import { beforeEach, describe, expect, it } from 'vitest';
import { useToasts } from './toasts.js';

beforeEach(() => useToasts.getState().clear());

describe('toasts', () => {
  it('띄운 순서대로 쌓인다', () => {
    useToasts.getState().show({ key: 'notice.saved' });
    useToasts.getState().show({ key: 'notice.copyDownloaded' });

    expect(useToasts.getState().toasts.map((t) => t.notice.key)).toEqual([
      'notice.saved',
      'notice.copyDownloaded',
    ]);
  });

  it('문장이 아니라 메시지 키를 담는다 — 언어를 바꾸면 함께 바뀌어야 한다', () => {
    useToasts.getState().show({ key: 'notice.saved', params: { name: 'a.html', count: 2 } });

    expect(useToasts.getState().toasts[0]?.notice).toEqual({
      key: 'notice.saved',
      params: { name: 'a.html', count: 2 },
    });
  });

  it('같은 알림이 연달아 오면 갈아 끼운다', () => {
    // 잠긴 블록을 여러 번 누르면 같은 문장이 화면을 덮는다.
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');

    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it('사이에 다른 알림이 끼면 새로 쌓는다', () => {
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');
    useToasts.getState().show({ key: 'notice.saved' });
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');

    expect(useToasts.getState().toasts).toHaveLength(3);
  });

  it('너무 많이 쌓이면 오래된 것부터 밀어낸다', () => {
    for (let i = 0; i < 10; i++) {
      useToasts.getState().show({ key: i % 2 === 0 ? 'notice.saved' : 'notice.copyDownloaded' });
    }

    expect(useToasts.getState().toasts.length).toBeLessThanOrEqual(4);
  });

  it('닫으면 그것만 사라진다', () => {
    useToasts.getState().show({ key: 'notice.saved' });
    useToasts.getState().show({ key: 'notice.saveFailed' }, 'error');
    const [first] = useToasts.getState().toasts;

    useToasts.getState().dismiss(first?.key ?? -1);

    expect(useToasts.getState().toasts.map((t) => t.notice.key)).toEqual(['notice.saveFailed']);
  });
});
