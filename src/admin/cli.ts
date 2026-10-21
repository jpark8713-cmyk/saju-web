// 관리 스크립트 명령 해석 (scripts/admin.ts가 부른다). 테스트에서 저장소·어댑터·출력을 바꿔 넣을 수 있게 분리했다.
//   refunds list [--status received|approved|rejected|refunded]
//   refunds show <접수번호>
//   refunds process <접수번호> --result refunded|rejected [--note "메모"] [--cancelled-externally]
//   orders recover-stuck
import { recoverStuckOrders } from '../orders/generation';
import type { PaymentProvider } from '../payments/types';
import type { RefundStatus, Store } from '../store/types';
import { AdminError, listRefundRows, processRefund, showRefund } from './refunds';

export interface AdminDeps {
  store: Store;
  provider: PaymentProvider | null;
  out: (line: string) => void;
  now?: Date;
}

export const USAGE = [
  '사용법:',
  '  npm run admin -- refunds list [--status received]',
  '  npm run admin -- refunds show <접수번호>',
  '  npm run admin -- refunds process <접수번호> --result refunded|rejected [--note "메모"] [--cancelled-externally]',
  '  npm run admin -- orders recover-stuck',
].join('\n');

const STATUSES: readonly RefundStatus[] = ['received', 'approved', 'rejected', 'refunded'];

function option(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 종료 코드를 돌려준다 (0 성공, 1 실패, 2 사용법 오류) */
export async function runAdmin(argv: readonly string[], deps: AdminDeps): Promise<number> {
  const [group, command, ...rest] = argv;
  const json = (v: unknown) => deps.out(JSON.stringify(v, null, 2));
  try {
    if (group === 'refunds' && command === 'list') {
      const status = option(rest, '--status');
      if (status && !STATUSES.includes(status as RefundStatus)) throw new AdminError(`--status는 ${STATUSES.join('|')} 중 하나예요`);
      json(await listRefundRows(deps.store, status as RefundStatus | undefined));
      return 0;
    }
    if (group === 'refunds' && command === 'show' && rest[0]) {
      const detail = await showRefund(deps.store, rest[0]);
      json(detail);
      if (detail.replyMatchesOrderEmail === false) deps.out('주의: 회신 이메일이 주문 때 이메일과 달라요. 다른 사람이 먼저 접수했을 수 있으니 주문 이메일로도 확인한 뒤 회신하세요.');
      deps.out('회신 이메일은 처리(process)하면 지워져요. 결과를 먼저 회신한 뒤 처리하세요.');
      return 0;
    }
    if (group === 'refunds' && command === 'process' && rest[0]) {
      const result = option(rest, '--result');
      if (result !== 'refunded' && result !== 'rejected') throw new AdminError('--result는 refunded 또는 rejected예요');
      const updated = await processRefund(
        deps.store,
        deps.provider,
        rest[0],
        { outcome: result, note: option(rest, '--note') ?? null, cancelledExternally: rest.includes('--cancelled-externally') },
        deps.now,
      );
      json({ refundId: updated.id, status: updated.status, processedAt: updated.processedAt, result: updated.result });
      return 0;
    }
    if (group === 'orders' && command === 'recover-stuck') {
      json({ recovered: await recoverStuckOrders(deps.store, deps.now) });
      return 0;
    }
    deps.out(USAGE);
    return 2;
  } catch (e) {
    if (e instanceof AdminError) {
      deps.out(`오류: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
