/**
 * pnpm 이 아닌 패키지 매니저의 락파일을 잡는다 (docs/rules.md §5.1).
 *
 * `packageManager` 필드로 pnpm 을 못박아도 `npm install` 은 그냥 돌아간다.
 * 그러면 CI(`pnpm install --frozen-lockfile`)와 다른 의존성 트리가 로컬에만
 * 생기고, 그 차이는 로컬에서만 재현되는 버그로 돌아온다.
 *
 * 조용히 두지 않고 verify 에서 끊는다.  실행: pnpm guard
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRAYS = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb', 'bun.lock'];

const found = STRAYS.filter((name) => existsSync(join(ROOT, name)));

if (found.length > 0) {
  console.error(`이 저장소의 락파일은 pnpm-lock.yaml 하나다. 남은 파일: ${found.join(', ')}`);
  console.error('지우고 다시 받아라:  rm ' + found.join(' ') + ' && pnpm install');
  process.exit(1);
}
