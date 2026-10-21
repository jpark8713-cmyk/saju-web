// 서버 시작 점검 (D-030). 운영 설정이 빠졌으면 요청을 받기 전에 멈춘다.
// - 저장소: 운영에서 DATABASE_URL(SQLite)이 없거나, DB 폴더가 볼륨이 아니면 멈춘다(src/store/index.ts).
// - 운영 필수 값: APP_ORIGIN, REFUND_ID_SECRET.
// - 시작할 때 멈춘 "생성 중" 주문을 실패로 바꿔 재시도·환불 안내로 이어지게 한다(서버가 생성 도중 죽은 경우).
// 출력에는 설정 이름과 건수만 쓰고 값은 쓰지 않는다.
import { isDevRuntime, type Env } from './config/flags';
import { appOrigin } from './config/origin';
import { refundIdSecret } from './config/secrets';
import { recoverStuckOrders } from './orders/generation';
import { getStore } from './store';
import type { Store } from './store/types';

export async function runStartupChecks(env: Env = process.env, store: () => Store = getStore): Promise<{ recovered: number; warnings: string[] }> {
  const warnings: string[] = [];
  if (!isDevRuntime(env)) {
    appOrigin('', env);
    refundIdSecret(env);
    if (env.TRUST_PROXY !== 'true') warnings.push('TRUST_PROXY가 true가 아니에요. 앞단 nginx가 X-Real-IP를 덮어쓰는 구성에서 true로 두세요(Docs/deploy.md).');
  }
  const recovered = await recoverStuckOrders(store(), new Date(), -1);
  for (const w of warnings) console.warn(`[시작 점검] ${w}`);
  if (recovered.length) console.warn(`[시작 점검] 멈춘 생성 주문 ${recovered.length}건을 실패로 바꿨어요(재시도·환불 안내).`);
  return { recovered: recovered.length, warnings };
}
