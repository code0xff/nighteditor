// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from './editor.js';
import { keepEdits, useUnsaved } from './unsaved.js';

/** 대화상자가 뜨기를 기다렸다가 대신 답한다 — 사람이 버튼을 누르는 자리다 */
async function answerWith(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  while (useUnsaved.getState().why === null) await Promise.resolve();
  useUnsaved.getState().reply(choice);
}

beforeEach(() => {
  useUnsaved.setState({ why: null, answer: null });
  useEditor.setState({ patches: new Map(), file: null });
});

describe('keepEdits', () => {
  it('고친 것이 없으면 묻지 않는다', async () => {
    // 물을 것이 없는데 뜨는 대화상자는 방해일 뿐이다.
    const go = await keepEdits({ key: 'confirm.whyOpen' });

    expect(go).toBe(true);
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('취소하면 하던 자리에 그대로 있는다', async () => {
    useEditor.setState({ patches: new Map([[0, '고친 값']]) });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('cancel');

    expect(await asked).toBe(false);
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('버리기를 고르면 계속한다', async () => {
    useEditor.setState({ patches: new Map([[0, '고친 값']]) });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('discard');

    expect(await asked).toBe(true);
  });

  it('저장을 고르면 저장한 뒤에 계속한다', async () => {
    const save = vi.fn().mockResolvedValue(true);
    useEditor.setState({ patches: new Map([[0, '고친 값']]), save });

    const asked = keepEdits({ key: 'confirm.whySwitch', params: { path: 'deck/b.html' } });
    await answerWith('save');

    expect(await asked).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('저장이 실패하면 계속하지 않는다', async () => {
    // 그대로 넘어가면 저장한 줄 알았던 편집이 사라진다.
    const save = vi.fn().mockResolvedValue(false);
    useEditor.setState({ patches: new Map([[0, '고친 값']]), save });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('save');

    expect(await asked).toBe(false);
  });

  it('무엇 때문에 사라지는지를 그대로 들고 있는다', async () => {
    useEditor.setState({ patches: new Map([[0, '고친 값']]) });

    const asked = keepEdits({ key: 'confirm.whySwitch', params: { path: 'deck/b.html' } });
    while (useUnsaved.getState().why === null) await Promise.resolve();

    expect(useUnsaved.getState().why).toEqual({
      key: 'confirm.whySwitch',
      params: { path: 'deck/b.html' },
    });
    useUnsaved.getState().reply('cancel');
    await asked;
  });

  it('묻는 중에 또 물으면 앞의 물음은 취소로 닫는다', async () => {
    // 답을 기다리는 프라미스를 그대로 두면 부른 쪽이 영영 풀리지 않는다.
    useEditor.setState({ patches: new Map([[0, '고친 값']]) });

    const first = keepEdits({ key: 'confirm.whyOpen' });
    const second = keepEdits({ key: 'confirm.whyAssets' });
    await answerWith('discard');

    expect(await first).toBe(false);
    expect(await second).toBe(true);
  });
});
