// 리포트 분량과 생성 설정. 사업자 결정(2026-10-20, 분량 "기본")에 따른 값이며 Docs/decisions.md D-015에 기록한다.

export const REPORT_LAYOUT = Object.freeze({
  /** 총평: 코드 템플릿 문장(무료 공개분) + AI가 이어 쓰는 문장 */
  summaryTemplateSentences: 2,
  summaryAiSentences: 2,
  traitsSentences: 5,
  topicSentences: 5,
  /** 대운 흐름: 현재·다음 대운 */
  daewoonNoteCount: 2,
  daewoonNoteSentences: 3,
  /** 올해·내년 흐름 */
  yearlySentences: 4,
  /** 문장 하나의 최대 글자 수 (공백 포함) */
  maxSentenceChars: 120,
});

/**
 * 풀이 생성 기본 모델 (사업자 결정 2026-10-20, D-021: 10건 측정 후 Sonnet 5.5).
 * 환경변수 LLM_MODEL로 바꿀 수 있다(예: LLM_MODEL=claude-opus-5-5). 단가는 src/llm/pricing.ts에 있어야 비용이 계산된다.
 */
export const DEFAULT_LLM_MODEL = 'claude-sonnet-5-5';

export const GENERATION = Object.freeze({
  /** 첫 시도 + 재시도 2회 (SPEC Phase 2: 최대 2회 재시도) */
  maxAttempts: 3,
  maxTokens: 16_000,
  /** Claude Opus 5.5·Sonnet 5.5 모두 지원. Opus 5.5 기본값이 medium이라 명시한다 */
  effort: 'medium' as const,
  /**
   * 리포트 한 건의 시간 상한(D-048, 사업자 결정 2026-10-22). 생성을 시작하고 이만큼 지나면
   * 반복·문장 다듬기(마지막 시도에서 봐주는 검사)로 다시 쓰지 않고 그때까지 나온 후보를 쓰며, 칸을 가로지르는 반복 줄이기도 건너뛴다.
   * 사실 오류(근거 불일치·금지 표현 등)는 시간이 지나도 고쳐 쓴다(maxAttempts까지).
   */
  softDeadlineMs: 60_000,
  /**
   * 리포트 한 건의 절대 시간 상한(D-049, 사업자 결정 2026-10-22). 닿으면 진행 중인 AI 호출을 끊고,
   * 끝나지 않은 칸(기본 칸·주제 칸)은 코드 템플릿 사실 문장(fallbackText.ts)으로 채운다. 주문은 실패시키지 않는다.
   */
  hardDeadlineMs: 150_000,
  /** 한 리포트에서 코드 사실 문장으로 바꾼 문장이 이 수를 넘으면 운영자 알림 로그를 남긴다(D-050, 사업자 결정) */
  templateAlertSentences: 8,
});
