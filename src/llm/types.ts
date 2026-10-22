// 풀이 생성 공용 타입

/** 리포트의 모든 풀이 문장 단위 (SPEC 4장 ReportSentence) */
import type { ReportAngles } from '../report/angleTable';

export interface ReportSentence {
  text: string;
  evidenceIds: string[];
}

/** 총평·성향·대운·세운 (기본 리포트 호출 결과) */
export interface BaseDraft {
  /** 템플릿 문장 뒤에 이어지는 AI 문장 */
  summary: ReportSentence[];
  traits: ReportSentence[];
  daewoonNotes: { daewoonIndex: number; sentences: ReportSentence[] }[];
  yearly: { thisYear: ReportSentence[]; nextYear: ReportSentence[] };
}

/** 주제 하나의 풀이 */
export interface TopicDraft {
  sentences: ReportSentence[];
}

export interface ReportBody {
  /** 템플릿 문장 + AI 문장 */
  summary: ReportSentence[];
  traits: ReportSentence[];
  /** 선택한 주제만 들어간다 */
  topics: Record<string, ReportSentence[]>;
  daewoonNotes: { daewoonIndex: number; sentences: ReportSentence[] }[];
  yearly: { thisYear: ReportSentence[]; nextYear: ReportSentence[] };
  /** 아이 리포트(만 13세 미만, D-044·D-045). 사실 카드도 "아이"로 쓴다. 없으면 어른 리포트 */
  audience?: 'child';
  /** 칸별 풀이 각도(D-047). 사실 카드의 "뜻 전체"와 "이 문장은 ○○ 쪽으로"에 쓴다. 없으면(이전 리포트) 보여 주지 않는다 */
  angles?: ReportAngles;
  /** 코드 사실 문장으로 바꾼 문장이 있는 작업(base, topic:wealth …): 시간 상한(D-049) 또는 검증·검수를 끝내 통과하지 못함(D-050). 없으면 모두 AI 문장 */
  templated?: string[];
  /** 코드 사실 문장으로 바꾼 문장 수 (D-050) */
  templatedSentences?: number;
  /** 다시 쓰게 하지 않고 기록만 남기는 검사에 걸린 최종 문장 수(D-051): 각도 이름 옮겨 쓰기, 합·충 얇은 끝맺음 */
  observed?: { angleCopy: number; thinRelation: number };
}

export type ViolationCode =
  | 'invalidJson'
  | 'schema'
  | 'sentenceCount'
  | 'tooLong'
  | 'emptyText'
  | 'multipleSentences'
  | 'noEvidence'
  | 'unknownEvidence'
  | 'termNotInEvidence'
  | 'termNotInCitedEvidence'
  | 'forbidden'
  | 'jargon'
  | 'aiFlagged'
  | 'numberNotInEvidence'
  | 'daewoonStartFormat'
  | 'wrongDaewoon'
  /** 올해·내년 마지막 문장이 이 사람의 기운 개수(elements.*)와 이어지지 않음 (D-045, D-048부터 검사하지 않는다. 이전 시도 기록용) */
  | 'adviceNotLinked'
  /** 내년 칸에서 그해를 "올해"로 부름 (D-045) */
  | 'wrongYearWord'
  /** 한 리포트에서 같은 풀이 말을 3문장 이상에 씀 (D-045) */
  | 'repeatedWord'
  /** 관계(합·충) 근거를 특정한 사람과의 관계로 바꿈 (D-045) */
  | 'relationAsPerson'
  /** 합·충을 인용한 문장이 행동 제안으로 끝남 (D-046) */
  | 'relationAsAdvice'
  /** 태어난 달 근거를 "사회 활동"의 자리로 풂 (D-046) */
  | 'positionMeaning'
  /** "~을 뜻하는 글자" 앞이 근거 목록의 묶음 이름이 아님 (D-046) */
  | 'groupLabel'
  /** 앞 문장에 기대는 표현 (D-046, 마지막 시도에서는 봐줌) */
  | 'dependentSentence'
  /** 근거에 없는 구체 사례 (D-047, 마지막 시도에서는 봐줌) */
  | 'concreteCase'
  /** 한 문장에 오행 표·묶음 표 각도를 섞음 (D-047, 마지막 시도에서는 봐줌) */
  | 'angleMix'
  /** 그해 기운을 주어로 두고 사주 글자 수를 말함 (D-048) */
  | 'yearNatalMix'
  /** 관계 이름만 바꿔 말하고 끝나는 문장 (D-048, 마지막 시도에서는 봐줌) */
  | 'vacuousRelation'
  /** 올해·내년 첫·마지막 문장이 그해 글자의 뜻·관계 없이 기운만으로 씀 (D-048, 마지막 시도에서는 봐줌) */
  | 'yearlyNotPersonal'
  /** 묶음 근거만 인용하고 원국 전체 글자 수를 개수 기준으로 씀 (D-049) */
  | 'countBase'
  /** 풀이 각도 이름 낱말을 그대로 옮김 (D-049, 마지막 시도에서는 봐줌) */
  | 'angleCopy'
  /** 한 문장에서 같은 말을 되풀이 (D-049, 마지막 시도에서는 봐줌) */
  | 'repeatedStem'
  /** 근거에 없는 개수를 만들어 씀 (D-049, 마지막 시도에서는 봐줌) */
  | 'inventedCount'
  /** 올해·내년 한 칸에서 같은 뜻 묶음이 3문장 이상 (D-049, 마지막 시도에서는 봐줌) */
  | 'yearlyGroupSkew'
  /** 한 문장에 개수 기준을 두 번 씀("내 사주 8글자 중 … 나를 뺀 7글자 중", D-051, 첫 시도에서만 봄) */
  | 'doubleBase'
  | 'refusal'
  | 'maxTokens';

export interface Violation {
  code: ViolationCode;
  /** 예: traits[2], topics.wealth[0] */
  path: string;
  detail: string;
}
