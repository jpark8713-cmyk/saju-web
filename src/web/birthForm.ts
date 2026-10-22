// 화면 2(정보 입력) 검증. 화면과 서버가 같은 함수를 쓴다(SPEC 1-1장: 필수값·시간 모름·음력·윤달을 양쪽에서 검증).
// 서버는 이 검증을 통과한 뒤 엔진 검증(존재하지 않는 음력 날짜·윤달, 지원 범위)을 한 번 더 한다.
import { z } from 'zod';
import { LUNAR_SUPPORTED_END, SUPPORTED_RANGE } from '../engine/settings';
import type { SajuInput } from '../engine/types';
import { findRegion } from '../config/regions';

export const NAME_MAX = 20;

export const birthFormSchema = z.object({
  name: z.string().optional(),
  calendar: z.enum(['solar', 'lunar']),
  isLeapMonth: z.boolean(),
  year: z.number().int().optional(),
  month: z.number().int().optional(),
  day: z.number().int().optional(),
  timeUnknown: z.boolean(),
  hour: z.number().int().optional(),
  minute: z.number().int().optional(),
  /** 분 칸에서 "분 모름"을 골랐는지(D-039). 이때 minute은 쓰지 않는다 */
  minuteUnknown: z.boolean().optional(),
  /** 분 모름 + 그 시 안에 경계가 있을 때의 답: 고른 구간의 시작 분, 또는 'unknown'(모름) */
  minuteSegment: z.union([z.number().int(), z.literal('unknown')]).optional(),
  gender: z.enum(['male', 'female']).optional(),
  regionId: z.string().optional(),
  consent: z.boolean(),
});

export type BirthForm = z.infer<typeof birthFormSchema>;

export type BirthField = 'name' | 'date' | 'time' | 'gender' | 'region' | 'consent' | 'form';
export type FieldErrors = Partial<Record<BirthField, string>>;

export interface ValidBirth {
  /** 표지 "○○님의 리포트"에만 쓴다. 주문 기록·로그에 남기지 않는다 */
  name: string | null;
  input: SajuInput;
  /** 분 모름일 때 표지에 쓸 시각 표기(예: "13시 33분 이후(분 모름)") */
  timeText?: string;
}

/** 분 구간 (엔진 minuteSegments의 구간에서 기둥을 뺀 것) */
export interface MinuteRange {
  fromMinute: number;
  toMinute: number;
}

/** 서버만 넘긴다: 그 시의 분 구간을 엔진으로 계산한다. 화면은 넘기지 않고 /api/time-boundary로 받는다 */
export interface BirthValidationOptions {
  segmentsOf?: (input: SajuInput & { time: { hour: number; minute: number } }) => readonly MinuteRange[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 경계가 하나일 때 묻는 문장: "13시 33분 이전인가요, 이후인가요?" */
export function boundaryQuestion(hour: number, ranges: readonly MinuteRange[]): string {
  if (ranges.length === 2) return `${hour}시 ${ranges[1]!.fromMinute}분 이전인가요, 이후인가요?`;
  return `${hour}시 몇 분쯤이었나요?`;
}

const spanOf = (hour: number, r: MinuteRange) => `${pad2(hour)}:${pad2(r.fromMinute)}~${pad2(hour)}:${pad2(r.toMinute)}`;

/** 구간 선택지 문구 */
export function rangeChoiceLabel(hour: number, ranges: readonly MinuteRange[], index: number): string {
  const r = ranges[index]!;
  const span = spanOf(hour, r);
  if (ranges.length === 2) return index === 0 ? `${ranges[1]!.fromMinute}분 이전 (${span})` : `${r.fromMinute}분 이후 (${span})`;
  return span;
}

/** 경계 전후를 아직 고르지 않았을 때의 안내 */
export function boundaryMissingMessage(hour: number, ranges: readonly MinuteRange[]): string {
  return ranges.length === 2
    ? `태어난 시각이 ${hour}시 ${ranges[1]!.fromMinute}분 이전인지 이후인지 골라 주세요. 모르면 '모름'을 골라 주세요.`
    : `태어난 시각이 ${hour}시 몇 분쯤이었는지 골라 주세요. 모르면 '모름'을 골라 주세요.`;
}

function isRealSolarDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d;
}

/** 형식·필수값 검증. 통과하면 엔진 입력으로 바꿔 준다 */
export function validateBirthForm(raw: unknown, options: BirthValidationOptions = {}): { ok: true; value: ValidBirth } | { ok: false; errors: FieldErrors } {
  const parsed = birthFormSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: { form: '입력 형식이 올바르지 않습니다.' } };
  const f = parsed.data;
  const errors: FieldErrors = {};

  const name = (f.name ?? '').trim();
  if ([...name].length > NAME_MAX) errors.name = `이름은 ${NAME_MAX}자 이내로 입력해 주세요.`;

  const { year, month, day } = f;
  // 연도를 범위 밖으로 넣었으면 월·일을 아직 안 넣었어도 범위 문구를 먼저 보여 준다
  if (year !== undefined && (year < SUPPORTED_RANGE.minYear || year > SUPPORTED_RANGE.maxYear)) {
    errors.date = `${SUPPORTED_RANGE.minYear}~${SUPPORTED_RANGE.maxYear}년 사이로 입력해 주세요.`;
  } else if (year === undefined || month === undefined || day === undefined) {
    errors.date = '생년월일을 입력해 주세요.';
  } else if (month < 1 || month > 12 || day < 1 || day > (f.calendar === 'lunar' ? 30 : 31)) {
    errors.date = '존재하지 않는 날짜입니다.';
  } else if (f.calendar === 'solar' && !isRealSolarDate(year, month, day)) {
    errors.date = '존재하지 않는 날짜입니다.';
  }

  if (!f.timeUnknown) {
    const { hour, minute } = f;
    if (hour === undefined && (minute !== undefined || f.minuteUnknown)) errors.time = '태어난 시간의 시를 선택해 주세요.';
    else if (hour !== undefined && minute === undefined && !f.minuteUnknown) errors.time = "태어난 시간의 분까지 선택해 주세요. 모르면 '분 모름'을 골라 주세요.";
    else if (hour === undefined) errors.time = '태어난 시간을 입력하거나 "모름"을 선택해 주세요.';
    else if (hour < 0 || hour > 23 || (!f.minuteUnknown && (minute! < 0 || minute! > 59))) errors.time = '시간 형식이 올바르지 않습니다.';
  }

  if (!f.gender) errors.gender = '성별을 선택해 주세요.';
  if (f.regionId && !findRegion(f.regionId)) errors.region = '태어난 지역을 다시 선택해 주세요.';
  if (!f.consent) errors.consent = '개인정보 수집·이용 동의가 필요해요.';

  if (Object.keys(errors).length) return { ok: false, errors };

  const input: SajuInput = {
    calendar: f.calendar,
    // 윤달은 음력일 때만 의미가 있다
    isLeapMonth: f.calendar === 'lunar' ? f.isLeapMonth : false,
    year: year!,
    month: month!,
    day: day!,
    time: f.timeUnknown ? null : { hour: f.hour!, minute: f.minuteUnknown ? 0 : f.minute! },
    gender: f.gender!,
    ...(f.regionId ? { birthplaceLongitude: findRegion(f.regionId)!.longitude } : {}),
  };
  if (f.timeUnknown || !f.minuteUnknown || !options.segmentsOf) return { ok: true, value: { name: name || null, input } };
  return resolveUnknownMinute(name || null, input as SajuInput & { time: { hour: number; minute: number } }, f.minuteSegment, options.segmentsOf);
}

/**
 * 분 모름(서버): 그 시 안에 경계가 없으면 0분으로 계산하고, 있으면 고른 구간의 시작 분으로 계산한다.
 * '모름'이면 시주 없이(hourOnly) 계산한다. 화면이 보낸 구간은 서버가 다시 계산한 구간과 맞아야 한다.
 */
function resolveUnknownMinute(
  name: string | null,
  input: SajuInput & { time: { hour: number; minute: number } },
  answer: number | 'unknown' | undefined,
  segmentsOf: NonNullable<BirthValidationOptions['segmentsOf']>,
): { ok: true; value: ValidBirth } | { ok: false; errors: FieldErrors } {
  const hour = input.time.hour;
  let ranges: readonly MinuteRange[];
  try {
    ranges = segmentsOf(input);
  } catch {
    // 날짜 오류(없는 음력 날짜 등)는 뒤의 엔진 계산이 같은 오류로 알려 준다
    return { ok: true, value: { name, input, timeText: `${pad2(hour)}시경(분 모름)` } };
  }
  if (ranges.length <= 1) return { ok: true, value: { name, input, timeText: `${pad2(hour)}시경(분 모름)` } };
  if (answer === undefined) return { ok: false, errors: { time: boundaryMissingMessage(hour, ranges) } };
  if (answer === 'unknown') {
    const { time: _drop, ...rest } = input;
    return { ok: true, value: { name, input: { ...rest, time: null, hourOnly: hour }, timeText: `${pad2(hour)}시대(분 모름, 시주 제외)` } };
  }
  const index = ranges.findIndex((r) => r.fromMinute === answer);
  if (index < 0) return { ok: false, errors: { time: boundaryMissingMessage(hour, ranges) } };
  return {
    ok: true,
    value: { name, input: { ...input, time: { hour, minute: answer } }, timeText: `${spanOf(hour, ranges[index]!)}(분 모름)` },
  };
}

/** 엔진 검증 오류를 화면 문구로 바꾼다. input을 주면 어느 칸을 어떻게 고칠지 더 구체적으로 알려 준다 */
export function engineErrorToField(code: string, input?: Pick<SajuInput, 'calendar' | 'year'>): FieldErrors {
  switch (code) {
    case 'outOfRange':
      // 음력 2050년 끝 무렵은 양력으로 2051년이라 범위를 벗어난다(입력한 연도는 범위 안이라 일반 문구로는 고칠 곳을 알 수 없다)
      if (input?.calendar === 'lunar' && input.year >= SUPPORTED_RANGE.minYear && input.year <= SUPPORTED_RANGE.maxYear) {
        const e = LUNAR_SUPPORTED_END;
        return { date: `음력으로는 ${e.year}년 ${e.month}월 ${e.day}일(양력 ${SUPPORTED_RANGE.maxYear}년 12월 31일)까지만 계산할 수 있어요. 그 전 날짜로 입력해 주세요.` };
      }
      return { date: `${SUPPORTED_RANGE.minYear}~${SUPPORTED_RANGE.maxYear}년 사이로 입력해 주세요.` };
    case 'invalidLunarDate':
      return { date: '존재하지 않는 음력 날짜입니다. 윤달 여부를 확인해 주세요.' };
    case 'invalidSolarDate':
      return { date: '존재하지 않는 날짜입니다.' };
    default:
      return { form: '생년월일·태어난 시간·태어난 지역을 다시 확인해 주세요.' };
  }
}
