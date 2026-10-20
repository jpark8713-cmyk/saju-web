// 모델 단가 (USD / 100만 토큰). 출처: Anthropic 가격표(claude-api 스킬, 2026-10-06 기준).
// 캐시 쓰기는 입력 단가의 1.25배(5분 캐시)로 계산한다. 가격이 바뀌면 이 표만 고친다.

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // AI 검수용. 가격표에는 입력·출력(10만 토큰 이하 프롬프트 기준)만 있어 캐시 단가는 입력의 0.1배·1.25배로 가정한다
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // 거절 폴백(fallbacks: "default")으로 실행될 수 있는 모델
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
});

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** 단가표에 없는 모델이면 null (비용을 지어내지 않는다) */
export function costUsd(u: TokenUsage): number | null {
  const p = MODEL_PRICES[u.model];
  if (!p) return null;
  return (
    (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
