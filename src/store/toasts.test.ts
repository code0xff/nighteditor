import { beforeEach, describe, expect, it } from 'vitest';
import { useToasts } from './toasts.js';

beforeEach(() => useToasts.getState().clear());

describe('toasts', () => {
  it('stacks in the order shown', () => {
    useToasts.getState().show({ key: 'notice.saved' });
    useToasts.getState().show({ key: 'notice.copyDownloaded' });

    expect(useToasts.getState().toasts.map((t) => t.notice.key)).toEqual([
      'notice.saved',
      'notice.copyDownloaded',
    ]);
  });

  it('holds message keys, not sentences — switching the language must change them too', () => {
    useToasts.getState().show({ key: 'notice.saved', params: { name: 'a.html', count: 2 } });

    expect(useToasts.getState().toasts[0]?.notice).toEqual({
      key: 'notice.saved',
      params: { name: 'a.html', count: 2 },
    });
  });

  it('replaces consecutive identical notifications', () => {
    // Clicking a locked block a few times would otherwise cover the screen with
    // the same sentence.
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');

    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it('stacks anew when another notification comes in between', () => {
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');
    useToasts.getState().show({ key: 'notice.saved' });
    useToasts.getState().show({ key: 'app.blocked' }, 'locked');

    expect(useToasts.getState().toasts).toHaveLength(3);
  });

  it('pushes out the oldest when too many stack up', () => {
    for (let i = 0; i < 10; i++) {
      useToasts.getState().show({ key: i % 2 === 0 ? 'notice.saved' : 'notice.copyDownloaded' });
    }

    expect(useToasts.getState().toasts.length).toBeLessThanOrEqual(4);
  });

  it('never pushes out errors — they must stay until a person dismisses them', () => {
    // If a few info notices passing by could erase a save failure, it might as
    // well have vanished on its own (spec §4).
    useToasts.getState().show({ key: 'notice.saveFailed' }, 'error');
    useToasts.getState().show({ key: 'notice.saved' });
    useToasts.getState().show({ key: 'notice.copyDownloaded' });
    useToasts.getState().show({ key: 'notice.assetsLinked' });
    useToasts.getState().show({ key: 'notice.folderTruncated' });

    const keys = useToasts.getState().toasts.map((t) => t.notice.key);
    expect(keys).toContain('notice.saveFailed');
    expect(keys).not.toContain('notice.saved');
    expect(useToasts.getState().toasts).toHaveLength(4);
  });

  it('keeps everything past the limit when all are errors', () => {
    useToasts.getState().show({ key: 'notice.saveFailed' }, 'error');
    useToasts.getState().show({ key: 'notice.openFailed' }, 'error');
    useToasts.getState().show({ key: 'notice.saveRejected' }, 'error');
    useToasts.getState().show({ key: 'notice.folderUnsupported' }, 'error');
    useToasts.getState().show({ key: 'notice.bundleNoDocument' }, 'error');

    expect(useToasts.getState().toasts).toHaveLength(5);
  });

  it('dismissing removes only that one', () => {
    useToasts.getState().show({ key: 'notice.saved' });
    useToasts.getState().show({ key: 'notice.saveFailed' }, 'error');
    const [first] = useToasts.getState().toasts;

    useToasts.getState().dismiss(first?.key ?? -1);

    expect(useToasts.getState().toasts.map((t) => t.notice.key)).toEqual(['notice.saveFailed']);
  });
});
