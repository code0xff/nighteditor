import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 테스트용 합성 아티팩트.
 *
 * 실제 Claude 아티팩트에서 문제가 됐던 구조를 한 파일에 모아 둔 것이다.
 * 암시적 `<tbody>`, 스크립트가 채우는 빈 `.pg`, 잠금이 상속돼야 하는 중첩 `.code`,
 * 엔티티와 이중 엔티티, 인라인 승격이 갈리는 두 가지 배치, 전역 클릭 핸들러,
 * `wrapSheets` 식 DOM 재구성이 모두 들어 있다.
 *
 * happy-dom 환경에서는 `import.meta.url` 이 file: 스킴이 아니라 쓸 수 없으므로
 * `process.cwd()` 기준으로 찾는다.
 */
export function fixtureSource(): string {
  return readFileSync(join(process.cwd(), 'src/__fixtures__/artifact.html'), 'utf8');
}

/**
 * 여러 파일로 흩어진 문서를 담은 **진짜 zip**.
 *
 * 손으로 조립한 바이트가 아니라 `zip` 이 만든 것이다 — 직접 만든 헤더는 내 오해까지
 * 그대로 베껴 담아서, 파서가 맞는지 틀리는지를 가리지 못한다.
 *
 * ```
 * deck/index.html   css/deck.css, img/logo.svg, js/deck.js 를 참조
 * deck/css/deck.css url(../fonts/mono.woff2) — 상위로 올라가는 경로
 * __MACOSX/         맥에서 압축하면 딸려오는 것
 * ```
 *
 * 다시 만들려면: `cd <폴더> && zip -q -r -X bundle.zip deck __MACOSX`
 */
export function fixtureBundle(): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), 'src/__fixtures__/bundle.zip')));
}
