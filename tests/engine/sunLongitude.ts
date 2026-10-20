// 독립 검산용 태양 겉보기 황경. Meeus 『Astronomical Algorithms』(2판) 25장 저정밀식(오차 약 0.01° ≈ 15분).
// 엔진·lunar-javascript와 다른 계산 경로로 절입 순간을 구해 비교한다.
// ΔT(TT-UT)는 무시한다. 1900~2050년 범위에서 약 -3~+90초라 허용 오차(±15분)에 비해 작다.

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;
const UNIX_EPOCH_JD = 2_440_587.5;

function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

/** UTC 순간의 태양 겉보기 황경(도) */
export function apparentSolarLongitude(instantMs: number): number {
  const jd = instantMs / DAY_MS + UNIX_EPOCH_JD;
  const T = (jd - 2_451_545.0) / 36_525;
  const L0 = 280.46646 + 36_000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35_999.05029 * T - 0.0001537 * T * T) * DEG;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * DEG;
  return norm360(L0 + C - 0.00569 - 0.00478 * Math.sin(omega));
}

/** target과의 부호 있는 각도 차(-180~180) */
function signedDiff(lon: number, target: number): number {
  return norm360(lon - target + 180) - 180;
}

/** guessMs 앞뒤 3일 안에서 황경이 target°가 되는 순간을 이분법으로 찾는다 */
export function solveSolarLongitude(target: number, guessMs: number): number {
  let lo = guessMs - 3 * DAY_MS;
  let hi = guessMs + 3 * DAY_MS;
  if (signedDiff(apparentSolarLongitude(lo), target) > 0 || signedDiff(apparentSolarLongitude(hi), target) < 0) {
    throw new Error(`황경 ${target}° 통과 구간을 찾지 못함`);
  }
  while (hi - lo > 1_000) {
    const mid = (lo + hi) / 2;
    if (signedDiff(apparentSolarLongitude(mid), target) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 12절의 황경 */
export const JIE_LONGITUDE: Record<string, number> = {
  소한: 285, 입춘: 315, 경칩: 345, 청명: 15, 입하: 45, 망종: 75,
  소서: 105, 입추: 135, 백로: 165, 한로: 195, 입동: 225, 대설: 255,
};
