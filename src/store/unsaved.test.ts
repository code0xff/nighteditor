// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from './editor.js';
import { keepEdits, useUnsaved } from './unsaved.js';

/**
 * 대화상자가 뜨기를 기다렸다가 대신 답한다 — 사람이 버튼을 누르는 자리다.
 *
 * 영영 기다리지 않는다. 물어야 하는데 묻지 않았다면 그 자리에서 실패해야
 * 무엇이 잘못됐는지 보인다. 무한정 돌면 테스트가 멈춘 것처럼만 보인다.
 */
async function answerWith(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  for (let tries = 0; useUnsaved.getState().why === null; tries++) {
    if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
    await Promise.resolve();
  }
  useUnsaved.getState().reply(choice);
}

/** 아직 파일에 없는 편집이 있는 상태 */
function edited(extra: Record<string, unknown> = {}): void {
  useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: true, ...extra });
}

beforeEach(() => {
  useUnsaved.setState({ why: null, answer: null });
  useEditor.setState({ patches: new Map(), file: null, unsaved: false });
});

describe('keepEdits', () => {
  it('고친 것이 없으면 묻지 않는다', async () => {
    // 물을 것이 없는데 뜨는 대화상자는 방해일 뿐이다.
    const go = await keepEdits({ key: 'confirm.whyOpen' });

    expect(go).toBe(true);
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('이미 저장했으면 묻지 않는다 — 잃을 것이 없다', async () => {
    // 저장해도 patches 는 남는다(INV-1). 그걸 "저장 안 함" 으로 읽으면 저장한 뒤에도 되묻는다.
    useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: false });

    expect(await keepEdits({ key: 'confirm.whyOpen' })).toBe(true);
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('취소하면 하던 자리에 그대로 있는다', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('cancel');

    expect(await asked).toBe(false);
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('버리기를 고르면 계속한다', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('discard');

    expect(await asked).toBe(true);
  });

  it('저장을 고르면 저장한 뒤에 계속한다', async () => {
    const save = vi.fn().mockResolvedValue(true);
    edited({ save });

    const asked = keepEdits({ key: 'confirm.whySwitch', params: { path: 'deck/b.html' } });
    await answerWith('save');

    expect(await asked).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('저장이 실패하면 계속하지 않는다', async () => {
    // 그대로 넘어가면 저장한 줄 알았던 편집이 사라진다.
    const save = vi.fn().mockResolvedValue(false);
    edited({ save });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('save');

    expect(await asked).toBe(false);
  });

  it('무엇 때문에 사라지는지를 그대로 들고 있는다', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whySwitch', params: { path: 'deck/b.html' } });
    await answerWith('cancel');

    expect(await asked).toBe(false);
  });

  it('묻는 중에 또 물으면 앞의 물음은 취소로 닫는다', async () => {
    // 답을 기다리는 프라미스를 그대로 두면 부른 쪽이 영영 풀리지 않는다.
    edited();

    const first = keepEdits({ key: 'confirm.whyOpen' });
    const second = keepEdits({ key: 'confirm.whyAssets' });
    await answerWith('discard');

    expect(await first).toBe(false);
    expect(await second).toBe(true);
  });
});
