import { buildChart } from '../../src/engine/chart';
import type { CalcSettings, SajuChart, SajuInput } from '../../src/engine/types';

export const REFERENCE_YEAR = 2026;

export function solar(
  year: number, month: number, day: number,
  time: { hour: number; minute: number } | null,
  extra: Partial<SajuInput> = {},
): SajuInput {
  return { calendar: 'solar', isLeapMonth: false, year, month, day, time, gender: 'male', ...extra };
}

export function chartOf(input: SajuInput, settings?: Partial<CalcSettings>): SajuChart {
  return buildChart(input, { referenceYear: REFERENCE_YEAR, settings });
}

/** UTC 순간 → 한국 표준시(UTC+9) 벽시계 */
export function kstWall(instantMs: number, offsetMinutes: number) {
  const d = new Date(instantMs + offsetMinutes * 60_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
