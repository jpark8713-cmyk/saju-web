// 경고(warnings)를 화면 안내용 데이터로 바꾼다. 문구는 사업자 결정(2026-10-20)의 기본안이며 바꿀 수 있다.
import { monthPillarAt, yearPillarAt } from './pillars';
import type { JieInstant } from './solarTerms';
import { civilFromMs, seoulOffsetMinutes } from './time';
import type { ChartNotice, ChartWarning } from './types';

export const NOTICE_MESSAGES: Readonly<Record<ChartWarning, string>> = Object.freeze({
  unknownTimeOnJieDay:
    '태어난 날에 절기가 바뀌는 시각이 있어요. 태어난 시간을 모르면 월주(입춘이면 년주도)가 달라질 수 있어요. ' +
    '정오 출생으로 계산했고, 절기 시각 전후의 결과를 함께 보여 드려요.',
  nonexistentWallTime:
    '입력하신 시각은 서머타임이 시작되면서 시계에 없었던 시각이에요. 표준시 기준으로 계산했어요.',
  ambiguousWallTime:
    '입력하신 시각은 서머타임이 끝나면서 두 번 있었던 시각이에요. 서머타임 기준(앞의 시각)으로 계산했어요.',
});

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 순간 → 한국 벽시계 표기. 서머타임·과거 표준시를 끄면 UTC+9로 본다 */
export function formatLocal(instantMs: number, historicalTimezone: boolean): string {
  const offset = historicalTimezone ? seoulOffsetMinutes(instantMs) : 540;
  const t = civilFromMs(Math.floor((instantMs + offset * 60_000) / 60_000) * 60_000);
  return `${t.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.minute)}`;
}

function pillarsAt(instantMs: number) {
  const { pillar: year } = yearPillarAt(instantMs);
  return { year, month: monthPillarAt(instantMs, year.stem) };
}

export function buildNotices(
  warnings: readonly ChartWarning[],
  jieOnDay: JieInstant | null,
  historicalTimezone: boolean,
): ChartNotice[] {
  return warnings.map((code): ChartNotice => {
    const base = { code, message: NOTICE_MESSAGES[code] };
    if (code !== 'unknownTimeOnJieDay' || !jieOnDay) return base;
    return {
      ...base,
      jie: {
        name: jieOnDay.name,
        localTime: formatLocal(jieOnDay.instantMs, historicalTimezone),
        ifBefore: pillarsAt(jieOnDay.instantMs - 60_000),
        ifAfter: pillarsAt(jieOnDay.instantMs),
      },
    };
  });
}
