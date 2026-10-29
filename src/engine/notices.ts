// 경고(warnings)를 화면 안내용 데이터로 바꾼다. 문구는 사업자 결정(2026-10-20)의 기본안이며 바꿀 수 있다.
import { monthPillarAt, yearPillarAt } from './pillars';
import type { JieInstant } from './solarTerms';
import { civilFromMs, seoulOffsetMinutes } from './time';
import type { ChartNotice, ChartWarning } from './types';

export const NOTICE_MESSAGES: Readonly<Record<ChartWarning, string>> = Object.freeze({
  unknownTimeOnJieDay:
    '태어난 날에 절기가 바뀌는 시각이 있어요. 태어난 시간을 모르면 월주(입춘이면 년주도)가 달라질 수 있어요. ' +
    '정오 출생으로 계산했고, 절기 시각 전후의 결과를 함께 보여 드려요.',
  unknownMinuteOnBoundary:
    '태어난 시의 몇 분이었는지에 따라 시주가 달라지는데, 분을 모르셔서 시주 없이 풀었어요. 분에 따라 달라지는 기둥을 함께 보여 드려요.',
  nonexistentWallTime:
    '입력하신 시각은 서머타임이 시작되면서 시계에 없었던 시각이에요. 표준시 기준으로 계산했어요.',
  ambiguousWallTime:
    '입력하신 시각은 서머타임이 끝나면서 두 번 있었던 시각이에요. 서머타임 기준(앞의 시각)으로 계산했어요.',
});

/** 1954-03-21 표준시 변경으로 생긴 두 번 있는 시각(D-056). 처리는 서머타임 종료와 같고 문구만 다르다 */
export const AMBIGUOUS_STANDARD_CHANGE_MESSAGE =
  '입력하신 시각은 1954년 3월 21일 표준시가 바뀌면서 두 번 있었던 시각이에요. 바뀌기 전 표준시(앞의 시각)로 계산했어요.';

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
  minute: ChartNotice['minute'] | null = null,
  ambiguousCause: 'dst' | 'standardChange' = 'dst',
): ChartNotice[] {
  return warnings.map((code): ChartNotice => {
    const message = code === 'ambiguousWallTime' && ambiguousCause === 'standardChange' ? AMBIGUOUS_STANDARD_CHANGE_MESSAGE : NOTICE_MESSAGES[code];
    const base = { code, message };
    if (code === 'unknownMinuteOnBoundary') return minute ? { ...base, minute } : base;
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
