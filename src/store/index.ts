// 앱 전체가 쓰는 저장소 고르기 (D-030).
// - DATABASE_URL=file:/data/saju.db 처럼 file: 주소면 SQLite.
// - 비어 있으면 메모리 저장소. 개발·테스트에서만 허용하고, 운영에서는 멈춘다(서버를 다시 켜면 주문이 사라지므로).
// - DB_REQUIRE_VOLUME=true(운영 이미지에 고정)면 DB 파일이 컨테이너 밖 볼륨에 있어야 한다. 컨테이너 안 파일이면 다시 만들 때 사라진다.
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDevRuntime, type Env } from '../config/flags';
import { MemoryStore } from './memory';
import { SqliteStore } from './sqlite';
import type { Store } from './types';

export class StoreMisconfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreMisconfigured';
  }
}

export function sqlitePathOf(url: string | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  if (!v.startsWith('file:')) throw new StoreMisconfigured('DATABASE_URL은 file:/경로 형식이어야 합니다(SQLite)');
  return resolve(v.slice('file:'.length));
}

type StatFn = (p: string) => { dev: number | bigint };

/** DB 파일이 있는 폴더가 루트(/)와 다른 파일 시스템(마운트된 볼륨)인지 확인한다 */
export function assertOnVolume(dbPath: string, stat: StatFn = statSync): void {
  const dir = dirname(dbPath);
  if (stat(dir).dev === stat('/').dev) {
    throw new StoreMisconfigured(`DB 폴더 ${dir}가 컨테이너 볼륨이 아닙니다. docker run -v <서버 경로>:${dir} 로 볼륨을 연결하세요`);
  }
}

export function createStore(env: Env = process.env, stat: StatFn = statSync): Store {
  const path = sqlitePathOf(env.DATABASE_URL);
  if (!path) {
    if (!isDevRuntime(env)) throw new StoreMisconfigured('운영 환경에는 DATABASE_URL(SQLite 파일)이 필요합니다');
    return new MemoryStore();
  }
  if (env.DB_REQUIRE_VOLUME === 'true') assertOnVolume(path, stat);
  return new SqliteStore(path);
}

const KEY = Symbol.for('saju.store');
type WithStore = typeof globalThis & { [KEY]?: Store };

/** 개발 서버가 모듈을 다시 불러와도 같은 저장소를 쓰도록 globalThis에 한 번만 만든다 */
export function getStore(): Store {
  const g = globalThis as WithStore;
  g[KEY] ??= createStore();
  return g[KEY];
}
