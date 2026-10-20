// 화면 2(정보 입력) 검증. 화면과 서버가 같은 함수를 쓴다(SPEC 1-1장: 필수값·시간 모름·음력·윤달을 양쪽에서 검증).
// 서버는 이 검증을 통과한 뒤 엔진 검증(존재하지 않는 음력 날짜·윤달, 지원 범위)을 한 번 더 한다.
import { z } from 'zod';
import { SUPPORTED_RANGE } from '../engine/settings';
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
}

function isRealSolarDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d;
}

/** 형식·필수값 검증. 통과하면 엔진 입력으로 바꿔 준다 */
export function validateBirthForm(raw: unknown): { ok: true; value: ValidBirth } | { ok: false; errors: FieldErrors } {
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
    if (hour === undefined || minute === undefined) errors.time = '태어난 시간을 입력하거나 "모름"을 선택해 주세요.';
    else if (hour < 0 || hour > 23 || minute < 0 || minute > 59) errors.time = '시간 형식이 올바르지 않습니다.';
  }

  if (!f.gender) errors.gender = '성별을 선택해 주세요.';
  if (f.regionId && !findRegion(f.regionId)) errors.region = '태어난 지역을 다시 선택해 주세요.';
  if (!f.consent) errors.consent = '개인정보 수집·이용에 동의해 주세요.';

  if (Object.keys(errors).length) return { ok: false, errors };

  const input: SajuInput = {
    calendar: f.calendar,
    // 윤달은 음력일 때만 의미가 있다
    isLeapMonth: f.calendar === 'lunar' ? f.isLeapMonth : false,
    year: year!,
    month: month!,
    day: day!,
    time: f.timeUnknown ? null : { hour: f.hour!, minute: f.minute! },
    gender: f.gender!,
    ...(f.regionId ? { birthplaceLongitude: findRegion(f.regionId)!.longitude } : {}),
  };
  return { ok: true, value: { name: name || null, input } };
}

/** 엔진 검증 오류를 화면 문구로 바꾼다 */
export function engineErrorToField(code: string): FieldErrors {
  switch (code) {
    case 'outOfRange':
      return { date: `${SUPPORTED_RANGE.minYear}~${SUPPORTED_RANGE.maxYear}년 사이로 입력해 주세요.` };
    case 'invalidLunarDate':
      return { date: '존재하지 않는 음력 날짜입니다. 윤달 여부를 확인해 주세요.' };
    case 'invalidSolarDate':
      return { date: '존재하지 않는 날짜입니다.' };
    default:
      return { form: '입력값을 다시 확인해 주세요.' };
  }
}
