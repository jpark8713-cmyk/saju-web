// 검증·비용 측정용 샘플 출생 정보 10건 (가상의 값, 실제 사람이 아니다).
// 경계 조건을 섞었다: 시간 모름, 음력·윤달, 자시, 절입일, 서머타임 기간, 남녀.
import type { SajuInput } from '../engine/types';

export const SAMPLE_REFERENCE_YEAR = 2026;

export const SAMPLE_INPUTS: readonly SajuInput[] = Object.freeze([
  { calendar: 'solar', isLeapMonth: false, year: 1990, month: 5, day: 15, time: { hour: 14, minute: 30 }, gender: 'male' },
  { calendar: 'solar', isLeapMonth: false, year: 1988, month: 9, day: 17, time: null, gender: 'female' },
  { calendar: 'lunar', isLeapMonth: true, year: 2020, month: 4, day: 15, time: { hour: 9, minute: 0 }, gender: 'female' },
  { calendar: 'solar', isLeapMonth: false, year: 1995, month: 8, day: 10, time: { hour: 23, minute: 50 }, gender: 'male' },
  { calendar: 'solar', isLeapMonth: false, year: 2024, month: 2, day: 4, time: null, gender: 'male' },
  { calendar: 'solar', isLeapMonth: false, year: 1987, month: 7, day: 15, time: { hour: 10, minute: 20 }, gender: 'female' },
  { calendar: 'solar', isLeapMonth: false, year: 1975, month: 12, day: 3, time: { hour: 6, minute: 5 }, gender: 'male' },
  { calendar: 'lunar', isLeapMonth: false, year: 1968, month: 1, day: 1, time: { hour: 18, minute: 40 }, gender: 'female' },
  { calendar: 'solar', isLeapMonth: false, year: 2001, month: 3, day: 21, time: { hour: 2, minute: 15 }, gender: 'female' },
  { calendar: 'solar', isLeapMonth: false, year: 1956, month: 11, day: 8, time: { hour: 12, minute: 0 }, gender: 'male', birthplaceLongitude: 129 },
]);
