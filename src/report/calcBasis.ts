// 리포트 끝 "면책·계산 기준"과 차트 아래 안내에 쓰는 계산 기준 문구(화면·PDF 공용). AI 프롬프트에는 넘기지 않는다.
import { pillarLabel } from '../engine/constants';
import { dayAndHourPillars } from '../engine/pillars';
import { civilFromMs } from '../engine/time';
import type { SajuChart } from '../engine/types';

export interface CalcBasis {
  jasi: string;
  timeCorrection: string;
  /** 서머타임·과거 표준시가 이 출생에 적용됐을 때만(아니면 null). 설정으로 껐으면 그 사실 */
  timezone: string | null;
  /** 경도 보정 때문에 시계 시각 그대로 볼 때와 일주·시주가 달라지면 한 줄(D-056). 화면·PDF에만 쓴다 */
  clockDiff: string | null;
  calendar: string;
  /** 오행·십성 개수를 세는 기준(D-008: 지장간 제외). 글자 수는 넣지 않는다(시간 모름이면 6글자라 문구가 달라지지 않게) */
  counting: string;
  /** 판정이 갈릴 수 있는 경우의 안내(엔진 notices). 차트 바로 아래에 보여 준다(D-039) */
  notices: { code: string; message: string; details: string[] }[];
}

const MINUTE_MS = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

/** 단어 뒤 "으로/로"(받침이 없거나 ㄹ 받침이면 "로"). 괄호 안 한자는 건너뛴다: 신축(辛丑) → 으로, 갑술(甲戌) → 로 */
function euro(word: string): string {
  const s = word.replace(/\([^)]*\)/g, '').replace(/[^가-힣]+$/u, '');
  const code = s.charCodeAt(s.length - 1) - 0xac00;
  const final = code >= 0 && code <= 11171 ? code % 28 : 0;
  return word + (final === 0 || final === 8 ? '로' : '으로');
}

function noticeDetails(n: SajuChart['notices'][number]): string[] {
  if (n.minute) {
    const h = n.minute.hour;
    return n.minute.segments.map((s) => {
      const p = s.pillars;
      return `${hhmm(h, s.fromMinute)}~${hhmm(h, s.toMinute)} 출생: 시주 ${p.hour ? pillarLabel(p.hour) : '-'} · 일주 ${pillarLabel(p.day)} · 월주 ${pillarLabel(p.month)} · 년주 ${pillarLabel(p.year)}`;
    });
  }
  if (n.jie) {
    const j = n.jie;
    return [
      `${j.name} 절입(${j.localTime}) 전 출생: 월주 ${pillarLabel(j.ifBefore.month)} · 년주 ${pillarLabel(j.ifBefore.year)}`,
      `${j.name} 절입 뒤 출생: 월주 ${pillarLabel(j.ifAfter.month)} · 년주 ${pillarLabel(j.ifAfter.year)}`,
    ];
  }
  return [];
}

/** 서머타임 중 오프셋(UTC+10, 1955~1960의 UTC+9:30)이면 1시간을 뺀 표준시 오프셋 */
function standardOffsetMinutes(offset: number): number {
  return offset === 600 || offset === 570 ? offset - 60 : offset;
}

/** 초 → "32분 5초", "1시간 2분" */
function durationText(totalSec: number): string {
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  const parts = [h ? `${h}시간` : '', m ? `${m}분` : '', s ? `${s}초` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '0초';
}

function hms(ms: number): string {
  const t = civilFromMs(ms);
  return `${hhmm(t.hour, t.minute)}:${pad(new Date(ms).getUTCSeconds())}`;
}

/**
 * 경도 보정 설명. 표준시와의 차이는 보정 후 시각을 초까지 내린 값에서 거꾸로 구해,
 * "32분 5초"와 예시 "23:30 → 22:57:55"가 어긋나 보이지 않게 한다(실제 차이 32분 4.8초).
 */
function timeCorrectionText(chart: SajuChart): string {
  const s = chart.settings;
  const missing = chart.input.hasTime ? null : chart.warnings.includes('unknownMinuteOnBoundary') ? '태어난 분 모름(시주 제외)' : '태어난 시간 모름(시주 제외)';
  if (!s.longitudeCorrection) return ['경도 보정 없음(한국 표준시 그대로)', missing].filter(Boolean).join(', ');
  const t = chart.time;
  const offset = s.historicalTimezone ? t.utcOffsetMinutes : 540;
  const isDst = s.historicalTimezone && standardOffsetMinutes(offset) !== offset;
  const stdWallMs = Math.round(t.instantMs + standardOffsetMinutes(offset) * MINUTE_MS);
  const localMs = Math.floor((t.instantMs + s.longitudeUsed * 4 * MINUTE_MS) / 1000) * 1000;
  const diffSec = Math.round((stdWallMs - localMs) / 1000);
  const head = `출생지 경도(동경 ${s.longitudeUsed}°)로 표준시보다 ${durationText(Math.abs(diffSec))} ${diffSec >= 0 ? '늦은' : '빠른'} 그 지역 시각을 써요`;
  if (missing) return `${head}. ${missing}`;
  const entered = civilFromMs(Math.round(t.instantMs + offset * MINUTE_MS));
  const std = civilFromMs(stdWallMs);
  const used = t.localSolarTime;
  const chain = isDst
    ? `입력 ${hhmm(entered.hour, entered.minute)} → 서머타임 1시간을 빼 ${hhmm(std.hour, std.minute)} → ${hms(localMs)}`
    : `입력 ${hhmm(entered.hour, entered.minute)} → ${hms(localMs)}`;
  return `${head}. ${chain}(초는 버리고 ${hhmm(used.hour, used.minute)} 기준으로 계산)`;
}

/** 서머타임·과거 표준시: 이 출생에 실제로 적용됐을 때만 */
function timezoneText(chart: SajuChart): string | null {
  if (!chart.settings.historicalTimezone) return '서머타임·과거 표준시 반영 안 함(한국 표준시 UTC+9로 계산)';
  const offset = chart.time.utcOffsetMinutes;
  const std = standardOffsetMinutes(offset);
  const parts = [
    std !== offset ? '서머타임 기간이라 1시간을 빼서 계산했어요' : null,
    std === 510 ? '당시 표준시 UTC+8:30(동경 127.5°)을 썼어요' : null,
    std < 510 ? '1908년 4월 전이라 당시 서울 지방시(UTC+8:27:52)를 썼어요' : null,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join('. ') : null;
}

/** 보정 없이 입력한 시계 시각 그대로 볼 때의 일주·시주와 다르면 한 줄(D-056) */
function clockDiffText(chart: SajuChart): string | null {
  const s = chart.settings;
  if (!chart.input.hasTime || !s.longitudeCorrection || !chart.pillars.hour) return null;
  const offset = s.historicalTimezone ? chart.time.utcOffsetMinutes : 540;
  const wall = civilFromMs(Math.floor((chart.time.instantMs + offset * MINUTE_MS) / MINUTE_MS) * MINUTE_MS);
  const asClock = dayAndHourPillars(wall, s.jasiMode, true);
  const same = (a: { stem: number; branch: number } | null, b: { stem: number; branch: number } | null) => !!a && !!b && a.stem === b.stem && a.branch === b.branch;
  const diffs = [
    same(asClock.day, chart.pillars.day) ? null : `일주가 ${pillarLabel(asClock.day)}`,
    same(asClock.hour, chart.pillars.hour) ? null : `시주가 ${asClock.hour ? pillarLabel(asClock.hour) : '-'}`,
  ].filter((x): x is string => !!x);
  if (!diffs.length) return null;
  return `이 리포트는 경도 보정 시각으로 기둥을 정했어요. 보정 없이 시계 시각 그대로(${hhmm(wall.hour, wall.minute)}) 보는 만세력에서는 ${euro(diffs.join(', '))} 다르게 나올 수 있어요`;
}

export function calcBasis(chart: SajuChart): CalcBasis {
  const s = chart.settings;
  return {
    jasi: s.jasiMode === 'split' ? '야자시·조자시 구분: 23시대는 일주를 그날로 두고, 시주는 다음 날 기준 자시로 봐요' : '23시부터 다음 날 일주',
    timeCorrection: timeCorrectionText(chart),
    timezone: timezoneText(chart),
    clockDiff: clockDiffText(chart),
    calendar: '년·월주는 절기 기준이고, 절입 전후는 경도 보정 없이 시계 시각(태어난 실제 순간)으로 판정해요. 음력은 한국천문연구원 자료예요',
    counting: '오행·십성 개수는 겉으로 드러난 천간·지지 글자만 셉니다(지장간은 세지 않습니다)',
    notices: chart.notices.map((n) => ({ code: n.code, message: n.message, details: noticeDetails(n) })),
  };
}
