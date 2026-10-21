// 개발 전용 기능 스위치. NODE_ENV가 development·test일 때만 켤 수 있다(사업자 결정 2026-10-20, D-025).
// production은 물론, 비어 있거나 staging 같은 다른 값이어도 환경변수와 관계없이 꺼진다(D-026).
// - 목 결제: PAYMENT_PROVIDER=mock일 때 목 결제창(/dev/mock-pg)으로 결제를 흉내 낸다(D-028). 운영에서는 결제 어댑터가 없는 것으로 본다.
// - 가짜 LLM: 실제 Claude API 대신 정해진 문장을 돌려준다(개발·E2E 테스트용, 비용 없음).

export type Env = Readonly<Record<string, string | undefined>>;

/** 개발·테스트 실행 환경인지 (허용 목록) */
export function isDevRuntime(env: Env = process.env): boolean {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

export function isMockPaymentAllowed(env: Env = process.env): boolean {
  return isDevRuntime(env) && env.PAYMENT_PROVIDER === 'mock';
}

export function isFakeLlmEnabled(env: Env = process.env): boolean {
  return isDevRuntime(env) && env.ENABLE_FAKE_LLM === 'true';
}
