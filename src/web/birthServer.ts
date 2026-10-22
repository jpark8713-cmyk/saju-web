// 서버용 입력 검증: 화면과 같은 검증에 "분 모름" 구간 계산(엔진)을 더한다(D-039).
// 화면 번들에 엔진이 들어가지 않도록 화면은 이 파일을 쓰지 않는다.
import { minuteSegments } from '../engine/minute';
import { validateBirthForm, type MinuteRange } from './birthForm';

export function validateBirthFormOnServer(raw: unknown): ReturnType<typeof validateBirthForm> {
  return validateBirthForm(raw, { segmentsOf: (input) => minuteSegments(input) });
}

/**
 * POST /api/time-boundary: 분 모름일 때 그 시 안의 분 구간. 구간이 하나면 분을 몰라도 결과가 같다.
 * 입력이 아직 덜 됐거나 날짜가 없으면 null(화면은 질문을 띄우지 않는다).
 */
export function minuteRangesFor(raw: unknown): MinuteRange[] | null {
  if (!raw || typeof raw !== 'object') return null;
  // 경계는 날짜·시·지역으로만 정해진다. 이름·성별·동의는 아직 비어 있어도 묻는다(성별은 기둥에 영향이 없다)
  const v = validateBirthForm({ ...raw, name: '', gender: 'female', consent: true, timeUnknown: false, minuteUnknown: true, minuteSegment: undefined });
  if (!v.ok || !v.value.input.time) return null;
  try {
    return minuteSegments(v.value.input).map(({ fromMinute, toMinute }) => ({ fromMinute, toMinute }));
  } catch {
    return null;
  }
}
