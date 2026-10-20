// 풀이 생성 공용 타입

/** 리포트의 모든 풀이 문장 단위 (SPEC 4장 ReportSentence) */
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
  | 'aiFlagged'
  | 'numberNotInEvidence'
  | 'daewoonStartFormat'
  | 'wrongDaewoon'
  | 'refusal'
  | 'maxTokens';

export interface Violation {
  code: ViolationCode;
  /** 예: traits[2], topics.wealth[0] */
  path: string;
  detail: string;
}
