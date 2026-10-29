// 만 나이 계산 한 곳(D-057). 아이 리포트 판정(report/audience)과 대운 시작 표기(engine/daewoon)가 함께 쓴다.

export interface YMD {
  year: number;
  month: number;
  day: number;
}

/** 만 나이: asOf 날짜에 생일이 지나지 않았으면 한 살 뺀다(생일 당일은 지난 것으로 본다) */
export function fullAge(birth: YMD, asOf: YMD): number {
  const passed = asOf.month > birth.month || (asOf.month === birth.month && asOf.day >= birth.day);
  return asOf.year - birth.year - (passed ? 0 : 1);
}
