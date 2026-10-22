// 풀이 근거(사실) 목록의 화면용 타입과 조사 처리(D-041, D-042). 화면 번들에 들어가므로 계산 모듈(절기·대운)은 가져오지 않는다.
// 문구 만들기(차트 값 → 쉬운 사실 문장)는 evidenceText.ts(서버)에서 한다.
import type { ChartRef } from '../engine/types';

// ---- 조사 ----

/** 마지막 한글 글자에 받침이 있는지. 괄호·따옴표·공백은 건너뛴다(을(乙) → 을, '상관' → 관) */
export function hasBatchim(word: string): boolean {
  const s = word.replace(/\([^)]*\)/g, '').replace(/[^가-힣]+$/u, '');
  const last = s.charCodeAt(s.length - 1);
  if (!(last >= 0xac00 && last <= 0xd7a3)) return false;
  return (last - 0xac00) % 28 !== 0;
}

const JOSA = {
  '은/는': ['은', '는'],
  '이/가': ['이', '가'],
  '을/를': ['을', '를'],
  '와/과': ['과', '와'],
  '이에요/예요': ['이에요', '예요'],
} as const;

/** 단어 뒤에 받침에 맞는 조사를 붙인다 */
export function josa(word: string, kind: keyof typeof JOSA): string {
  const [withBatchim, without] = JOSA[kind];
  return word + (hasBatchim(word) ? withBatchim : without);
}

// ---- 사실 목록 ----

/** 타고난 사실(나) / 시기·흐름에 대한 사실 */
export type EvidenceGroupId = 'natal' | 'luck';

export const EVIDENCE_GROUP_TITLES: Readonly<Record<EvidenceGroupId, string>> = Object.freeze({
  natal: '타고난 나에 대한 사실',
  luck: '시기·흐름에 대한 사실',
});

export const EVIDENCE_GROUP_ORDER: readonly EvidenceGroupId[] = ['natal', 'luck'];

/** 이 사실을 인용한 풀이 문장 */
export interface EvidenceUse {
  /** 문장 앵커 id (SentenceView.id) */
  sentenceId: string;
  /** 문장이 있는 칸 이름 (총평, 재물, 2026년 …) */
  where: string;
  text: string;
}

export interface EvidenceItem {
  /** 사실 번호. 목록 순서대로 1부터. PDF 각주 번호로 쓴다 */
  n: number;
  /** 사실 키(합친 근거끼리 같다) */
  id: string;
  /** 이 사실에 합쳐진 근거 id (문장이 인용한 것만) */
  ids: string[];
  group: EvidenceGroupId;
  /** 이 사람에 대한 사실, 쉬운 말 (용어 정의 없음) */
  content: string;
  /** "자세히"에서 보여 줄 용어 풀이와 전문 표기 */
  detail: string[];
  chartRefs: ChartRef[];
  /** 이 사실을 쓴 풀이 문장 (화면 목록의 ↳ 줄) */
  usedBy: EvidenceUse[];
  /** 기운·뜻 묶음의 풀이 각도 전체(D-047). 예: "흙의 뜻: 터전·자리 잡음 / 버팀·오래 감 / …". 화면 "자세히"와 PDF 목록에 보여 준다 */
  meanings?: string[];
}
