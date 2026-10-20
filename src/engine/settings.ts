import type { CalcSettings } from './types';

/**
 * 계산 기본값. 사업자 결정(2026-10-20)에 따른 값이며 근거는 Docs/decisions.md에 있다.
 */
export const DEFAULT_SETTINGS: Readonly<CalcSettings> = Object.freeze({
  jasiMode: 'split',
  longitudeCorrection: true,
  historicalTimezone: true,
  defaultLongitude: 127,
  unknownTimeAssumption: Object.freeze({ hour: 12, minute: 0 }),
  daewoonCount: 10,
  daewoonRounding: 'floor',
});

/** 지원 범위 (주 라이브러리의 한국 음력 데이터 범위) */
export const SUPPORTED_RANGE = Object.freeze({ minYear: 1900, maxYear: 2050 });

/** 경도 허용 범위 (동경, 도) */
export const LONGITUDE_RANGE = Object.freeze({ min: 120, max: 135 });

/** 설정 오류는 사용자 입력이 아니라 코드 설정 실수이므로 일반 Error로 던진다 */
export function validateSettings(s: CalcSettings): void {
  const problems = [
    s.jasiMode !== 'split' && s.jasiMode !== 'unified' ? 'jasiMode' : null,
    typeof s.longitudeCorrection !== 'boolean' ? 'longitudeCorrection' : null,
    typeof s.historicalTimezone !== 'boolean' ? 'historicalTimezone' : null,
    !Number.isFinite(s.defaultLongitude) || s.defaultLongitude < LONGITUDE_RANGE.min || s.defaultLongitude > LONGITUDE_RANGE.max
      ? 'defaultLongitude'
      : null,
    !isValidClock(s.unknownTimeAssumption) ? 'unknownTimeAssumption' : null,
    !Number.isInteger(s.daewoonCount) || s.daewoonCount < 1 || s.daewoonCount > 12 ? 'daewoonCount' : null,
    s.daewoonRounding !== 'floor' && s.daewoonRounding !== 'round' ? 'daewoonRounding' : null,
  ].filter((p): p is string => p !== null);
  if (problems.length) throw new Error(`계산 설정 값이 올바르지 않습니다: ${problems.join(', ')}`);
}

export function isValidClock(t: { hour: number; minute: number } | null | undefined): boolean {
  return (
    !!t &&
    Number.isInteger(t.hour) && Number.isInteger(t.minute) &&
    t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59
  );
}
