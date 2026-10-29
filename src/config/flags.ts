// 개발 전용 기능 스위치와 운영 빌드 판정(D-025·D-026·D-058).
// - 운영 빌드(next build → next start)인지는 NODE_ENV가 아니라 빌드 때 번들에 박은 단계(SAJU_BUILD_PHASE, next.config.ts)로 판단한다.
//   NODE_ENV는 실행할 때 환경 파일로 바꿀 수 있어서(next start는 경고만 하고 따른다), 운영 빌드에서 개발 기능이 켜질 수 있었다.
// - 목 결제: 개발 서버(NODE_ENV development·test)에서 PAYMENT_PROVIDER=mock일 때, 또는 운영 빌드의 예행 모드(REHEARSAL_MODE=1)에서만 켠다.
// - 가짜 LLM: 개발 서버에서만 켤 수 있다. 운영 빌드에서는 어떤 경우에도 켜지지 않는다(설정하면 시작 거부, src/config/deployGuard.ts).

export type Env = Readonly<Record<string, string | undefined>>;

/** 빌드 단계. next dev는 phase-development-server, next build·start는 운영 빌드. 테스트·스크립트(번들 밖)에서는 undefined */
export const BUILD_PHASE: string | undefined = process.env.SAJU_BUILD_PHASE;

/** 운영 빌드(next build로 만든 번들을 next start로 띄운 것)인지 */
export function isProductionBuild(phase: string | undefined = BUILD_PHASE): boolean {
  return phase === 'phase-production-build' || phase === 'phase-production-server';
}

/** 개발·테스트 실행 환경인지 (허용 목록). 운영 빌드는 NODE_ENV와 관계없이 개발 환경이 아니다 */
export function isDevRuntime(env: Env = process.env, phase: string | undefined = BUILD_PHASE): boolean {
  return !isProductionBuild(phase) && (env.NODE_ENV === 'development' || env.NODE_ENV === 'test');
}

/** 운영 빌드의 예행 연습 모드(REHEARSAL_MODE=1). 값이 "1"일 때만 켠다(다른 값은 시작 거부) */
export function isRehearsal(env: Env = process.env): boolean {
  return env.REHEARSAL_MODE === '1';
}

export function isMockPaymentAllowed(env: Env = process.env, phase: string | undefined = BUILD_PHASE): boolean {
  if (env.PAYMENT_PROVIDER !== 'mock') return false;
  return isProductionBuild(phase) ? isRehearsal(env) : isDevRuntime(env, phase);
}

export function isFakeLlmEnabled(env: Env = process.env, phase: string | undefined = BUILD_PHASE): boolean {
  return isDevRuntime(env, phase) && env.ENABLE_FAKE_LLM === 'true';
}

/** 상태 확인 주소·배너에 쓰는 실행 모드 */
export function runMode(env: Env = process.env, phase: string | undefined = BUILD_PHASE): 'rehearsal' | 'production' | 'development' {
  if (isRehearsal(env)) return 'rehearsal';
  return isProductionBuild(phase) ? 'production' : 'development';
}
