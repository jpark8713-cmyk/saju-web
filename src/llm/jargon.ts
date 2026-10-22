// 풀이 문장에 남은 전문 용어를 찾는다(D-042). 찾으면 검증 위반(jargon)으로 다시 생성한다.
// 일반 낱말과 겹치는 말은 문맥으로 가른다: "일주일"의 일주, "계획을 세운"의 세운, "주변의 지지"의 지지는 잡지 않는다.
// 순행·역행은 일반 낱말(흐름에 역행하다)이라 검증하지 않고 프롬프트의 "쓰지 않는 말"로만 둔다.
import { TEN_GOD_GROUPS, TEN_GOD_KO } from '../engine/constants';
import { tenGodNames } from './terms';

/** 문장에 쓰지 않는 전문 용어 (프롬프트의 "쓰지 않는 말" 목록과 같다) */
export const JARGON_WORDS: readonly string[] = [
  '일간', '월간', '원국', '천간', '지지', '년주', '월주', '일주', '시주', '년지', '월지', '일지', '시지', '오행', '음양', '십신',
  ...Object.values(TEN_GOD_KO), ...TEN_GOD_GROUPS.map((g) => g.ko), '칠살',
  '대운', '세운', '순행', '역행', '육합', '삼합',
];

const FRONT = '(?<![가-힣])';
const PATTERNS: readonly { re: RegExp; label?: string }[] = [
  { re: new RegExp(`${FRONT}(일간|원국|천간|오행|음양|십신|대운|육합|삼합|년지|월지|시지)`, 'gu') },
  // D-049: 기둥 윗글자 이름 "월간"(7차에 "월간의 병(丙)"이 나왔다). 잡지 "월간"과 겹치지 않게 뒤에 글자 표기·조사가 올 때만.
  // "시간"은 일상어("쉬는 시간은 자(子) 같은")와 겹쳐 넣지 않는다(리뷰 반영)
  { re: new RegExp(`${FRONT}(월간|년간)(?=(의|은|는|이|과|와)?\\s?[가-힣]\\()`, 'gu') },
  // 일지: 뒤에 글자 표기가 올 때만 (업무 일지는 일반 낱말)
  { re: new RegExp(`${FRONT}일지(?=\\s?[가-힣]\\()`, 'gu') },
  // 지지: 뒤에 글자 표기가 올 때만 (주변의 지지, 지지를 받다는 일반 낱말)
  { re: new RegExp(`${FRONT}지지(?=\\s?[가-힣]\\()`, 'gu') },
  // 기둥 이름: 일주일은 뺀다
  { re: new RegExp(`${FRONT}(년주|월주|시주|일주(?!일))`, 'gu') },
  // 세운: 조사가 바로 붙거나 글자 표기가 올 때만 ("계획을 세운 사람"은 일반 낱말)
  { re: new RegExp(`${FRONT}세운(?=[은이에의도과을를]|\\s?[가-힣]\\()`, 'gu') },
  // 오행의 한자 표기: 토(土), 임수(壬水)
  { re: /[목화토금수]\([木火土金水]\)/gu, label: '오행 한자 표기' },
  { re: /[가-힣][목화토금수]\(\p{Script=Han}{2}\)/gu, label: '일간 표기(예: 임수(壬水))' },
  { re: /[음양]\([陰陽]\)/gu, label: '음양' },
];

/** 문장에 남은 전문 용어 (중복 없이, 찾은 순서) */
export function findJargon(text: string): string[] {
  const found = new Set<string>();
  for (const { re, label } of PATTERNS) for (const m of text.matchAll(re)) found.add(label ?? m[1] ?? m[0]);
  for (const name of tenGodNames(text)) found.add(name);
  return [...found];
}
