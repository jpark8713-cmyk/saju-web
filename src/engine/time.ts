// 출생 시각 해석: 현지 벽시계 시각 → 출생 순간(UTC) → 경도 보정 현지 시각.
// 서머타임·과거 표준시는 런타임에 내장된 IANA tzdb(Asia/Seoul)를 쓴다. 네트워크를 쓰지 않는다.
import type { CalcSettings, CivilDateTime, TimeResolution } from './types';

const MINUTE_MS = 60_000;
const KST_STANDARD_OFFSET_MIN = 540;
const SEOUL_TZ = 'Asia/Seoul';

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SEOUL_TZ,
  timeZoneName: 'longOffset',
});

/**
 * 1954-03-21 표준시 변경(UTC+9 → UTC+8:30). 대통령령 제876호 원문은 "3월 21일 오전 0시 30분부터"(옛 시계 기준)인데
 * tzdb는 0시에 바꾼다. 원문대로 그 30분(UTC 1954-03-20 15:00~15:30)은 UTC+9로 둔다(Docs/TIMEZONE_HISTORY.md, D-056).
 * 그래서 03-21 00:00~00:29가 두 번 있는 시각이 된다.
 */
const DECREE_1954_KEEP_UTC9 = { fromMs: Date.UTC(1954, 2, 20, 15, 0), toMs: Date.UTC(1954, 2, 20, 15, 30) };

/** 주어진 순간의 Asia/Seoul UTC 오프셋(분, 초 단위 오프셋은 반올림하지 않고 분수로 유지) */
export function seoulOffsetMinutes(instantMs: number): number {
  if (instantMs >= DECREE_1954_KEEP_UTC9.fromMs && instantMs < DECREE_1954_KEEP_UTC9.toMs) return KST_STANDARD_OFFSET_MIN;
  const part = offsetFormatter.formatToParts(new Date(instantMs)).find((p) => p.type === 'timeZoneName');
  const text = part?.value ?? 'GMT';
  const match = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const [h, m, s] = [match[2], match[3], match[4] ?? '0'].map(Number) as [number, number, number];
  return sign * (h * 60 + m + s / 60);
}

function wallAsUtcMs(dt: CivilDateTime): number {
  return Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute);
}

interface WallResolution {
  instantMs: number;
  offsetMinutes: number;
  nonexistent: boolean;
  ambiguous: boolean;
}

/**
 * 벽시계 시각을 순간으로 바꾼다.
 * - 두 번 있는 시각(서머타임 종료, 1954-03-21 표준시 변경)은 앞의 순간(바뀌기 전 시계 쪽)을 택한다.
 * - 없는 시각(서머타임 시작)은 전환 직전 오프셋(표준시)으로 해석한다.
 */
export function resolveSeoulWallTime(dt: CivilDateTime): WallResolution {
  const wallMs = wallAsUtcMs(dt);
  // 전후 하루 범위에서 나타나는 오프셋 후보를 모은다
  const probes = [-1440, -720, -180, 0, 180, 720, 1440].map((d) => wallMs + d * MINUTE_MS);
  const offsets = [...new Set(probes.map(seoulOffsetMinutes))];
  const valid = offsets
    .map((off) => ({ off, instant: wallMs - off * MINUTE_MS }))
    .filter((c) => seoulOffsetMinutes(c.instant) === c.off)
    .sort((a, b) => a.instant - b.instant);
  const first = valid[0];
  if (first) {
    return { instantMs: first.instant, offsetMinutes: first.off, nonexistent: false, ambiguous: valid.length > 1 };
  }
  // 없는 시각: 3시간 전의 오프셋(전환 직전)으로 해석
  const before = seoulOffsetMinutes(wallMs - (KST_STANDARD_OFFSET_MIN + 180) * MINUTE_MS);
  return { instantMs: wallMs - before * MINUTE_MS, offsetMinutes: before, nonexistent: true, ambiguous: false };
}

export function civilFromMs(ms: number): CivilDateTime {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/**
 * 출생 시각을 해석한다.
 * 경도 보정: 출생 순간(UTC) + 경도×4분 = 평균태양시. 균시차(equation of time)는 반영하지 않는다.
 * 경도 보정을 끄면 한국 표준시(UTC+9) 기준 시각을 쓴다.
 */
export function resolveBirthTime(
  wall: CivilDateTime,
  settings: Pick<CalcSettings, 'historicalTimezone' | 'longitudeCorrection'>,
  longitude: number,
): TimeResolution {
  const resolved = settings.historicalTimezone
    ? resolveSeoulWallTime(wall)
    : {
        instantMs: wallAsUtcMs(wall) - KST_STANDARD_OFFSET_MIN * MINUTE_MS,
        offsetMinutes: KST_STANDARD_OFFSET_MIN,
        nonexistent: false,
        ambiguous: false,
      };
  const localOffsetMin = settings.longitudeCorrection ? longitude * 4 : KST_STANDARD_OFFSET_MIN;
  // 분 미만은 버려 시각 경계 판정을 결정적으로 만든다
  const localMs = Math.floor((resolved.instantMs + localOffsetMin * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  return {
    instantMs: resolved.instantMs,
    utcOffsetMinutes: resolved.offsetMinutes,
    localSolarTime: civilFromMs(localMs),
    nonexistentWallTime: resolved.nonexistent,
    ambiguousWallTime: resolved.ambiguous,
  };
}
