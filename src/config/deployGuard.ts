// 운영 빌드 시작 거부 조건(D-058, 사업자 결정). 결제 안전 경계라 하나라도 걸리면 서버를 띄우지 않는다(src/startup.ts → instrumentation).
// 출력에는 설정 이름과 주제 id만 쓰고 값은 쓰지 않는다.
import { BUILD_PHASE, isProductionBuild, isRehearsal, type Env } from './flags';
import { TOPICS, type TopicConfig } from './topics';

/** 실제 PG 키(Docs/deploy.md 2장). 예행 모드에서는 하나라도 있으면 시작 거부 */
const REAL_PG_KEYS = ['PAYMENT_CLIENT_KEY', 'PAYMENT_SECRET_KEY'] as const;

/** 걸린 조건마다 한 줄. 빈 배열이면 시작해도 된다 */
export function deploymentProblems(
  env: Env = process.env,
  phase: string | undefined = BUILD_PHASE,
  topics: readonly Pick<TopicConfig, 'id' | 'enabled' | 'reviewed'>[] = TOPICS,
): string[] {
  const prod = isProductionBuild(phase);
  const rehearsal = isRehearsal(env);
  const set = (k: string) => (env[k] ?? '') !== '';
  const problems: string[] = [];
  if (set('REHEARSAL_MODE') && !rehearsal) problems.push('REHEARSAL_MODE는 "1"만 쓸 수 있어요(끄려면 줄을 지우세요)');
  // 예행 모드와 실제 PG를 함께 켜면 "실제 결제 아님" 배너 아래에서 실제 결제가 일어난다. PG 키가 들어 있는 것만으로도 막는다
  const realPg = [...(set('PAYMENT_PROVIDER') && env.PAYMENT_PROVIDER !== 'mock' ? ['PAYMENT_PROVIDER'] : []), ...REAL_PG_KEYS.filter(set)];
  if (rehearsal && realPg.length) problems.push(`REHEARSAL_MODE=1과 실제 PG 설정(${realPg.join(', ')})을 함께 쓸 수 없어요`);
  if (!prod) return problems;
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') problems.push(`운영 빌드(next start)인데 NODE_ENV가 ${env.NODE_ENV}예요`);
  if (set('ENABLE_FAKE_LLM')) problems.push('운영 빌드에서는 ENABLE_FAKE_LLM을 쓸 수 없어요(줄을 지우세요)');
  if (env.PAYMENT_PROVIDER === 'mock' && !rehearsal) problems.push('PAYMENT_PROVIDER=mock은 예행 모드(REHEARSAL_MODE=1)에서만 쓸 수 있어요');
  const unreviewed = topics.filter((t) => t.enabled && !t.reviewed).map((t) => t.id);
  if (unreviewed.length && !rehearsal) problems.push(`검수(reviewed)를 마치지 않은 판매 주제가 있어요: ${unreviewed.join(', ')}`);
  return problems;
}
