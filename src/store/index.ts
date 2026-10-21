// 앱 전체가 쓰는 저장소 고르기 (D-030, D-031).
// - DATABASE_URL=file:/data/saju.db 처럼 file: 주소면 SQLite.
// - 비어 있으면 메모리 저장소. 개발·테스트에서만 허용하고, 운영에서는 멈춘다(서버를 다시 켜면 주문이 사라지므로).
// - DB_REQUIRE_VOLUME=true(운영 이미지에 고정)면 DB 폴더가 이름 지정 볼륨이나 서버 경로(bind mount)로 연결돼 있어야 한다.
//   컨테이너의 마운트 목록(/proc/self/mountinfo)에서 확인한다. 연결이 없거나, 이름 없는 볼륨이거나, 메모리(tmpfs)면 시작하지 않는다.
//   DB 폴더 권한이 700(그룹·다른 사용자 권한 없음)이 아니어도 시작하지 않는다.
import { readFileSync, statSync } from 'node:fs';
import { posix, resolve } from 'node:path';
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

export interface MountEntry {
  /** 원본 파일 시스템 안의 경로 (볼륨이면 .../volumes/<이름>/_data, 서버 경로면 그 경로) */
  root: string;
  mountPoint: string;
  fsType: string;
}

/** mountinfo의 \040 같은 8진수 이스케이프를 푼다 */
const unescape = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));

/** /proc/self/mountinfo 형식을 읽는다 (예: "36 35 98:0 /srv/saju/data /data rw - ext4 /dev/vda1 rw") */
export function parseMountInfo(text: string): MountEntry[] {
  const entries: MountEntry[] = [];
  for (const line of text.split('\n')) {
    const [left, right] = line.split(' - ');
    if (!left || !right) continue;
    const f = left.trim().split(/\s+/);
    if (f.length < 5) continue;
    entries.push({ root: unescape(f[3]!), mountPoint: unescape(f[4]!), fsType: right.trim().split(/\s+/)[0] ?? '' });
  }
  return entries;
}

const ANONYMOUS_VOLUME = /\/volumes\/[0-9a-f]{64}\/_data$/;
const readMountInfo = () => readFileSync('/proc/self/mountinfo', 'utf8');

/** DB 폴더가 이름 지정 볼륨이나 서버 경로로 연결돼 있는지 확인한다. 아니면 시작하지 않는다 */
export function assertOnVolume(dbPath: string, mountInfo: () => string = readMountInfo): void {
  const dir = posix.dirname(dbPath.replace(/\\/g, '/'));
  const hint = `docker run -v <서버 경로 또는 볼륨 이름>:${dir} 로 연결하세요`;
  let text: string;
  try {
    text = mountInfo();
  } catch {
    throw new StoreMisconfigured(`마운트 목록을 읽을 수 없어 DB 폴더 ${dir}의 볼륨 연결을 확인하지 못했습니다. ${hint}`);
  }
  // DB 폴더를 담는 마운트 중 가장 깊은 것을 본다(/data/db/saju.db면 /data/db나 /data). 루트(/)는 연결 없음으로 본다.
  // 같은 자리에 여러 번 마운트되면 마지막 것이 보인다
  const contains = (mp: string) => mp !== '/' && (dir === mp || dir.startsWith(mp.endsWith('/') ? mp : `${mp}/`));
  const candidates = parseMountInfo(text).filter((m) => contains(m.mountPoint));
  const deepest = Math.max(-1, ...candidates.map((m) => m.mountPoint.length));
  const mount = candidates.filter((m) => m.mountPoint.length === deepest).at(-1);
  if (!mount) throw new StoreMisconfigured(`DB 폴더 ${dir}에 볼륨이 연결되지 않았습니다. ${hint}`);
  if (mount.fsType === 'tmpfs' || mount.fsType === 'ramfs') throw new StoreMisconfigured(`DB 폴더 ${dir}가 메모리(${mount.fsType})라 서버를 다시 켜면 사라집니다. ${hint}`);
  if (ANONYMOUS_VOLUME.test(mount.root)) throw new StoreMisconfigured(`DB 폴더 ${dir}에 이름 없는 볼륨이 연결됐습니다. 컨테이너를 다시 만들면 찾기 어려워집니다. ${hint}`);
}

type ModeOf = (dir: string) => number;
const modeOf: ModeOf = (dir) => statSync(dir).mode;

/** DB 폴더는 소유자만 쓸 수 있어야 한다(권한 700, 개인정보가 들어 있다, D-031) */
export function assertPrivateDir(dbPath: string, mode: ModeOf = modeOf): void {
  const dir = posix.dirname(dbPath.replace(/\\/g, '/'));
  const m = mode(dir) & 0o777;
  if ((m & 0o077) !== 0) {
    throw new StoreMisconfigured(`DB 폴더 ${dir}의 권한이 ${m.toString(8)}이에요. 서버에서 chmod 700 <데이터 폴더> 로 소유자만 읽게 하세요`);
  }
}

export function createStore(env: Env = process.env, mountInfo: () => string = readMountInfo, mode: ModeOf = modeOf): Store {
  const path = sqlitePathOf(env.DATABASE_URL);
  if (!path) {
    if (!isDevRuntime(env)) throw new StoreMisconfigured('운영 환경에는 DATABASE_URL(SQLite 파일)이 필요합니다');
    return new MemoryStore();
  }
  if (env.DB_REQUIRE_VOLUME === 'true') {
    assertOnVolume(path, mountInfo);
    assertPrivateDir(path, mode);
  }
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
