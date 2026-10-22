// 리포트를 읽는 사람: 만 13세 미만 사주는 부모가 아이를 관찰하고 돌볼 때 참고하는 리포트로 쓴다(사업자 결정 2026-10-22, D-044).
// 무료 미리보기와 결제 후 리포트가 같은 기준을 써야 총평 템플릿 문장이 같아진다.
import type { SajuChart } from '../engine/types';

/** 이 나이(만) 미만이면 아이 리포트 */
export const CHILD_AGE_LIMIT = 13;

interface YMD {
  year: number;
  month: number;
  day: number;
}

/** 한국 시간 기준 날짜 */
export function kstDateOf(d: Date): YMD {
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return { year: k.getUTCFullYear(), month: k.getUTCMonth() + 1, day: k.getUTCDate() };
}

/** 만 나이: 생일이 지나지 않았으면 한 살 뺀다 */
export function fullAge(birth: YMD, asOf: YMD): number {
  const passed = asOf.month > birth.month || (asOf.month === birth.month && asOf.day >= birth.day);
  return asOf.year - birth.year - (passed ? 0 : 1);
}

/** 기준 시각(주문 시각 등)에 만 13세 미만이면 true. 생일은 계산에 쓴 양력 날짜로 본다 */
export function isChildChart(chart: SajuChart, asOf: Date): boolean {
  return fullAge(chart.solarDate, kstDateOf(asOf)) < CHILD_AGE_LIMIT;
}

/** 이 나이(만) 이하 아이는 규칙·책임 글자를 약속·책임이 아니라 일과·순서·습관으로 푼다(D-045) */
export const TODDLER_MAX_AGE = 5;

/** 대운 하나를 누구에게 맞춰 쓰는지: 그 10년 동안의 만 나이 범위 */
export interface DaewoonAudience {
  index: number;
  fromAge: number;
  toAge: number;
  /** 그 10년 안에 만 13세 이상이 된다: 부모 조언이 아니라 그 나이대에 맞는 문장으로 쓴다 */
  grown: boolean;
}

export interface Audience {
  child: boolean;
  /** 만 5세 이하 */
  toddler: boolean;
  age: number;
  daewoon: DaewoonAudience[];
}

/** 아이 리포트 여부와 대운별 나이 범위 (D-044·D-045) */
export function audienceOf(chart: SajuChart, asOf: Date, daewoonIndices: readonly number[]): Audience {
  const age = fullAge(chart.solarDate, kstDateOf(asOf));
  const child = age < CHILD_AGE_LIMIT;
  const daewoon = daewoonIndices.flatMap((index): DaewoonAudience[] => {
    const d = chart.daewoon[index];
    if (!d) return [];
    const fromAge = fullAge(chart.solarDate, { year: d.startYear, month: d.startMonth, day: d.startDay });
    const toAge = fromAge + 9;
    return [{ index, fromAge, toAge, grown: toAge >= CHILD_AGE_LIMIT }];
  });
  return { child, toddler: child && age <= TODDLER_MAX_AGE, age, daewoon };
}
