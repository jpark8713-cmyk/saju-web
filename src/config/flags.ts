// 개발 전용 기능 스위치. NODE_ENV가 development·test일 때만 켤 수 있다(사업자 결정 2026-10-20, D-025).
// production은 물론, 비어 있거나 staging 같은 다른 값이어도 환경변수와 관계없이 꺼진다(D-026).
// - 가짜 결제: 결제 화면에 "성공·실패" 버튼을 보여 주고 결제 완료·실패를 흉내 낸다. Phase 4에서 결제 어댑터(목 구현)로 바뀐다.
// - 가짜 LLM: 실제 Claude API 대신 정해진 문장을 돌려준다(개발·E2E 테스트용, 비용 없음).

type Env = Readonly<Record<string, string | undefined>>;

function devOnly(env: Env, name: string): boolean {
  return (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') && env[name] === 'true';
}

export function isFakePaymentEnabled(env: Env = process.env): boolean {
  return devOnly(env, 'ENABLE_FAKE_PAYMENT');
}

export function isFakeLlmEnabled(env: Env = process.env): boolean {
  return devOnly(env, 'ENABLE_FAKE_LLM');
}
