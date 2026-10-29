// 서버 시작 점검 (D-030). 운영 설정이 빠졌으면 요청을 받기 전에 멈춘다.
// - 저장소: 운영에서 DATABASE_URL(SQLite)이 없거나, DB 폴더가 볼륨이 아니면 멈춘다(src/store/index.ts).
// - 운영 빌드 시작 거부 조건(D-058): src/config/deployGuard.ts. 걸리면 저장소를 열기 전에 멈춘다.
// - 운영 필수 값: APP_ORIGIN, REFUND_ID_SECRET.
// - 시작할 때 멈춘 "생성 중" 주문을 실패로 바꿔 재시도·환불 안내로 이어지게 한다(서버가 생성 도중 죽은 경우).
// - 메일을 보내는 도중에 서버가 멈춘 주문은 이어서 보낸다(D-033).
// 출력에는 설정 이름과 건수만 쓰고 값은 쓰지 않는다.
import { deploymentProblems } from './config/deployGuard';
import { BUILD_PHASE, isDevRuntime, isRehearsal, type Env } from './config/flags';
import { appOrigin } from './config/origin';
import { refundIdSecret } from './config/secrets';
import { resumeEmailDeliveries, type DeliveryDeps } from './delivery/deliver';
import { deliveryDeps } from './delivery/runtime';
import { recoverStuckOrders } from './orders/generation';
import { getStore } from './store';
import type { Store } from './store/types';

export async function runStartupChecks(
  env: Env = process.env,
  store: () => Store = getStore,
  delivery: () => DeliveryDeps = () => deliveryDeps(),
  phase: string | undefined = BUILD_PHASE,
): Promise<{ recovered: number; resumedEmails: number; warnings: string[] }> {
  const warnings: string[] = [];
  // 결제 안전 경계(D-058): 운영 빌드에 개발 기능·검수 전 주제가 섞이면 무엇보다 먼저 멈춘다
  const problems = deploymentProblems(env, phase);
  if (problems.length) throw new Error(`운영 설정 점검 실패: ${problems.join(' / ')}`);
  if (isRehearsal(env)) warnings.push('예행 모드(REHEARSAL_MODE=1)로 떠요. 모든 화면에 "실제 결제 아님" 배너가 나와요. 출시 전에 이 줄을 지우세요.');
  if (!isDevRuntime(env, phase)) {
    appOrigin('', env);
    refundIdSecret(env);
    if (env.TRUST_PROXY !== 'true') warnings.push('TRUST_PROXY가 true가 아니에요. 앞단 nginx가 X-Real-IP를 덮어쓰는 구성에서 true로 두세요(Docs/deploy.md).');
  }
  const recovered = await recoverStuckOrders(store(), new Date(), -1);
  const resumedEmails = await resumeEmailDeliveries(delivery());
  for (const w of warnings) console.warn(`[시작 점검] ${w}`);
  if (recovered.length) console.warn(`[시작 점검] 멈춘 생성 주문 ${recovered.length}건을 실패로 바꿨어요(재시도·환불 안내).`);
  if (resumedEmails) console.warn(`[시작 점검] 보내다 멈춘 메일 ${resumedEmails}건을 이어서 보내요.`);
  return { recovered: recovered.length, resumedEmails, warnings };
}
