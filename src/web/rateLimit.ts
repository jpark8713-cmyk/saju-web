// 고정 구간 횟수 제한(메모리). 서버 한 대 기준이다. IP별 속도 제한의 주 방어선은 앞단 nginx다(사업자 결정 2026-10-21, D-030).
// 키에는 주문번호·IP만 쓰고 이메일은 넣지 않는다.
// 메모리·CPU 보호(D-029·D-030): 만료된 키 청소는 1분에 한 번만 한다. 키 수가 상한에 닿으면 새 키를 거부하지 않고
// 가장 오래 쓰이지 않은 키를 지운다(기록이 차도 정상 고객이 막히지 않게). 지워진 키의 횟수는 처음부터 다시 센다.
import type { WindowLimit } from '../config/limits';

export class RateLimited extends Error {
  constructor() {
    super('요청이 너무 많습니다');
    this.name = 'RateLimited';
  }
}

export const MAX_KEYS = 50_000;
const SWEEP_EVERY_MS = 60_000;

export class RateLimiter {
  /** Map은 넣은 순서를 지킨다. 쓸 때마다 지우고 다시 넣어, 맨 앞이 가장 오래 쓰이지 않은 키가 되게 한다 */
  private readonly hits = new Map<string, { start: number; count: number; windowMs: number }>();
  private lastSweep = 0;
  /** 상한 때문에 지운 키 수 (운영 지표) */
  evicted = 0;

  constructor(private readonly maxKeys = MAX_KEYS) {}

  get size(): number {
    return this.hits.size;
  }

  /** 한 번 센다. 한도를 넘었으면 false (넘은 요청도 세어 계속 막는다) */
  hit(key: string, limit: WindowLimit, now = Date.now()): boolean {
    this.sweep(now);
    const cur = this.hits.get(key);
    if (cur) this.hits.delete(key);
    else if (this.hits.size >= this.maxKeys) this.evictOldest();
    const entry = !cur || now - cur.start >= limit.windowMs ? { start: now, count: 0, windowMs: limit.windowMs } : cur;
    const next = { ...entry, count: entry.count + 1 };
    this.hits.set(key, next);
    return next.count <= limit.max;
  }

  /** 세지 않고 지금 구간의 횟수만 본다 */
  count(key: string, now = Date.now()): number {
    const cur = this.hits.get(key);
    return cur && now - cur.start < cur.windowMs ? cur.count : 0;
  }

  private evictOldest(): void {
    const oldest = this.hits.keys().next();
    if (!oldest.done) {
      this.hits.delete(oldest.value);
      this.evicted += 1;
    }
  }

  /** 만료된 키를 지운다. 1분에 한 번만 돈다 */
  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [k, v] of this.hits) if (now - v.start >= v.windowMs) this.hits.delete(k);
  }
}

const KEY = Symbol.for('saju.rateLimiter');
type WithLimiter = typeof globalThis & { [KEY]?: RateLimiter };

export function sharedRateLimiter(): RateLimiter {
  const g = globalThis as WithLimiter;
  g[KEY] ??= new RateLimiter();
  return g[KEY];
}
