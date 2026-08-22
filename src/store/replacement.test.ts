import { describe, expect, it } from 'vitest';
import { reserveReplacement, Superseded } from './replacement.js';

describe('reserveReplacement · guarded (spec §5 · 갈아 끼우기 예약)', () => {
  it('최신이면 값을 그대로 돌려준다', async () => {
    const mine = reserveReplacement();

    await expect(mine.guarded(Promise.resolve('값'))).resolves.toBe('값');
  });

  it('기다리는 사이 밀려났으면 Superseded 를 던진다', async () => {
    // await 뒤의 예약 확인을 손으로 적는 방식은 같은 자리를 아홉 번 틀렸다 —
    // 긴 단계는 이 통로를 지나야 확인을 잊을 수 없다.
    const mine = reserveReplacement();
    const slow = Promise.resolve().then(() => {
      // 기다리는 사이 사용자가 다른 파일을 놓았다 — 더 새 예약이 선다.
      reserveReplacement();
      return '늦은 값';
    });

    await expect(mine.guarded(slow)).rejects.toBeInstanceOf(Superseded);
  });

  it('원래 실패는 표식으로 바꾸지 않고 그대로 흘려보낸다', async () => {
    // 표식으로 바꾸면 취소로 끝난 흐름의 실패 알림(대원칙 3)까지 조용히 사라진다.
    const mine = reserveReplacement();

    await expect(mine.guarded(Promise.reject(new Error('원인')))).rejects.toThrow('원인');
  });
});
