// 분을 모를 때: 그 "시" 안(0~59분)에서 네 기둥이 바뀌는 지점을 찾는다(D-039).
// 경계 분은 지역(경도)·연도(서머타임·과거 표준시)·자시 처리 방식에 따라 달라지므로 규칙으로 정하지 않고 분마다 계산한다.
import { resolveSolarDate } from './calendar';
import { computePillars } from './pillars';
import { DEFAULT_SETTINGS, isValidClock, validateSettings } from './settings';
import { resolveBirthTime } from './time';
import type { CalcSettings, PillarSet, SajuInput } from './types';

/** 같은 결과가 나오는 분 구간 [fromMinute, toMinute] */
export interface MinuteSegment {
  fromMinute: number;
  toMinute: number;
  pillars: PillarSet;
}

const same = (a: PillarSet, b: PillarSet) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 그 시(hour)의 0~59분을 결과(년·월·일·시주)가 같은 구간으로 나눈다. 구간이 하나면 분을 몰라도 결과가 같다.
 * input.time의 minute은 쓰지 않는다.
 */
export function minuteSegments(input: SajuInput, settingsOverride: Partial<CalcSettings> = {}): MinuteSegment[] {
  const settings: CalcSettings = { ...DEFAULT_SETTINGS, ...settingsOverride };
  validateSettings(settings);
  if (!input.time || !isValidClock({ hour: input.time.hour, minute: 0 })) throw new Error('시(hour) 값이 올바르지 않습니다');
  const hour = input.time.hour;
  const date = resolveSolarDate(input);
  const longitude = input.birthplaceLongitude ?? settings.defaultLongitude;
  const segments: MinuteSegment[] = [];
  for (let minute = 0; minute < 60; minute += 1) {
    const time = resolveBirthTime({ ...date, hour, minute }, settings, longitude);
    const pillars = computePillars({ instantMs: time.instantMs, local: time.localSolarTime, hasTime: true, jasiMode: settings.jasiMode });
    const last = segments[segments.length - 1];
    if (last && same(last.pillars, pillars)) last.toMinute = minute;
    else segments.push({ fromMinute: minute, toMinute: minute, pillars });
  }
  return segments;
}
