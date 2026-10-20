// 절입(節入) 시각. lunar-javascript의 천문 계산값(베이징 시간, UTC+8)을 UTC 순간으로 바꿔 쓴다.
// 주 라이브러리(manseryeok)의 월주는 하루 단위라 절입 시각 전후를 구분하지 못해 쓰지 않는다(Docs/decisions.md D-004).
import lunarJs from 'lunar-javascript';

const BEIJING_OFFSET_MS = 8 * 3_600_000;

/** 12절(월의 시작). branch는 그 절기부터 시작되는 월지 */
export const JIE_TERMS = [
  { key: '小寒', ko: '소한', branch: 1 },
  { key: '立春', ko: '입춘', branch: 2 },
  { key: '惊蛰', ko: '경칩', branch: 3 },
  { key: '清明', ko: '청명', branch: 4 },
  { key: '立夏', ko: '입하', branch: 5 },
  { key: '芒种', ko: '망종', branch: 6 },
  { key: '小暑', ko: '소서', branch: 7 },
  { key: '立秋', ko: '입추', branch: 8 },
  { key: '白露', ko: '백로', branch: 9 },
  { key: '寒露', ko: '한로', branch: 10 },
  { key: '立冬', ko: '입동', branch: 11 },
  { key: '大雪', ko: '대설', branch: 0 },
] as const;

export interface JieInstant {
  /** 한국어 절기명 */
  name: string;
  /** 이 절기부터 시작되는 월지 */
  branch: number;
  /** 절입 순간 (UTC epoch ms) */
  instantMs: number;
  /** 이 절기가 속한 양력 연도 */
  year: number;
}

const cache = new Map<number, readonly JieInstant[]>();

/** 양력 year 한 해의 12절 (소한~대설) */
export function jieOfYear(year: number): readonly JieInstant[] {
  const hit = cache.get(year);
  if (hit) return hit;
  const table = lunarJs.Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable();
  const list = JIE_TERMS.map((t) => {
    const s = table[t.key];
    if (!s) throw new Error(`절기표에 ${t.key}가 없습니다 (${year})`);
    const instantMs =
      Date.UTC(s.getYear(), s.getMonth() - 1, s.getDay(), s.getHour(), s.getMinute(), s.getSecond()) -
      BEIJING_OFFSET_MS;
    return Object.freeze({ name: t.ko, branch: t.branch, instantMs, year });
  });
  const frozen = Object.freeze(list);
  cache.set(year, frozen);
  return frozen;
}

/** 입춘 순간 */
export function ipchunOf(year: number): number {
  const ip = jieOfYear(year).find((j) => j.branch === 2);
  if (!ip) throw new Error(`입춘을 찾을 수 없습니다 (${year})`);
  return ip.instantMs;
}

function jieAround(instantMs: number): JieInstant[] {
  const y = new Date(instantMs).getUTCFullYear();
  return [...jieOfYear(y - 1), ...jieOfYear(y), ...jieOfYear(y + 1)];
}

/** 순간 이전(같은 순간 포함)의 가장 가까운 절입 */
export function prevJie(instantMs: number): JieInstant {
  const found = jieAround(instantMs)
    .filter((j) => j.instantMs <= instantMs)
    .sort((a, b) => b.instantMs - a.instantMs)[0];
  if (!found) throw new Error('이전 절입을 찾을 수 없습니다');
  return found;
}

/** 순간 이후의 가장 가까운 절입 */
export function nextJie(instantMs: number): JieInstant {
  const found = jieAround(instantMs)
    .filter((j) => j.instantMs > instantMs)
    .sort((a, b) => a.instantMs - b.instantMs)[0];
  if (!found) throw new Error('다음 절입을 찾을 수 없습니다');
  return found;
}
