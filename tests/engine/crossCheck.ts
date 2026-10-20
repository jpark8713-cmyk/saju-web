// 교차검증 도우미: 같은 출생을 lunar-javascript의 팔자 계산에 넣어 결과를 비교한다.
// lunar-javascript는 벽시계 시각을 베이징 시간(UTC+8)으로 해석하므로 순간(UTC)을 UTC+8 벽시계로 바꿔 넣는다.
import lunarJs from 'lunar-javascript';
import type { SajuChart } from '../../src/engine/types';
import { pillarHanja } from '../../src/engine/constants';

const BEIJING_MS = 8 * 3_600_000;

function solarAt(ms: number) {
  const d = new Date(ms);
  return lunarJs.Solar.fromYmdHms(
    d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
  );
}

export interface LibPillars {
  year: string;
  month: string;
  day: string;
  hour: string | null;
}

/** 년·월주는 출생 순간 기준, 일·시주는 엔진이 쓴 현지(경도 보정) 시각 기준으로 lunar-javascript에 묻는다 */
export function lunarJsPillars(chart: SajuChart): LibPillars {
  const ym = solarAt(chart.time.instantMs + BEIJING_MS).getLunar().getEightChar();
  const l = chart.time.localSolarTime;
  const dh = lunarJs.Solar.fromYmdHms(l.year, l.month, l.day, l.hour, l.minute, 0).getLunar().getEightChar();
  dh.setSect(chart.settings.jasiMode === 'split' ? 2 : 1);
  return { year: ym.getYear(), month: ym.getMonth(), day: dh.getDay(), hour: chart.input.hasTime ? dh.getTime() : null };
}

export function enginePillars(chart: SajuChart): LibPillars {
  const p = chart.pillars;
  return {
    year: pillarHanja(p.year),
    month: pillarHanja(p.month),
    day: pillarHanja(p.day),
    hour: p.hour ? pillarHanja(p.hour) : null,
  };
}

/** lunar-javascript의 대운 시작(sect 2: 분 단위 환산, 4320분=1년, 360분=1개월) */
export function lunarJsDaewoon(chart: SajuChart) {
  const ec = solarAt(chart.time.instantMs + BEIJING_MS).getLunar().getEightChar();
  const yun = ec.getYun(chart.input.gender === 'male' ? 1 : 0, 2);
  return {
    years: yun.getStartYear(),
    months: yun.getStartMonth(),
    forward: yun.isForward(),
    pillars: yun.getDaYun(11).slice(1).map((d) => d.getGanZhi()),
  };
}

