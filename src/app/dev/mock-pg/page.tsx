// 목 결제창 (개발·테스트 전용, D-028). 실제 PG의 결제창 자리에 띄운다. 운영 환경에서는 404다.
// 브라우저 스크립트 없이 서버가 그리는 폼만 쓴다(운영 클라이언트 번들에 목 결제 코드가 들어가지 않게).
// 금액 칸을 바꿀 수 있게 두어, 클라이언트가 금액을 바꿔 보내는 경우를 재현한다.
import { notFound } from 'next/navigation';
import { isMockPaymentAllowed } from '../../../config/flags';
import { sharedMockProvider } from '../../../payments';

export const dynamic = 'force-dynamic';

const OUTCOMES = [
  { id: 'success', label: '결제 성공' },
  { id: 'fail', label: '결제 취소 (화면 A)' },
  { id: 'success-genfail', label: '결제 성공 후 풀이 생성 실패 (화면 B)' },
] as const;

type Session = NonNullable<ReturnType<ReturnType<typeof sharedMockProvider>['session']>>;

/** 이미 처리했거나 찾을 수 없는 결제창(뒤로 가기로 돌아온 결제창, 서버를 다시 켠 뒤의 결제창) */
function Processed({ session }: { session: Session | null }) {
  const [title, text, href, label] = !session
    ? ['결제창 정보를 찾을 수 없어요', '서버를 다시 켰거나 주소가 바뀐 결제창이에요. 미리보기에서 결제창을 새로 열어 주세요.', '/preview', '미리보기로 돌아가기']
    : session.state === 'failed'
      ? ['이미 취소한 결제창이에요', '다시 결제하려면 미리보기에서 결제창을 새로 열어 주세요.', '/preview', '미리보기로 돌아가기']
      : ['이미 처리된 결제예요', '이 결제창은 한 번만 쓸 수 있어요. 주문 화면에서 진행 상황을 확인해 주세요.', `/orders/${encodeURIComponent(session.orderId)}`, '주문 화면으로 가기'];
  return (
    <main className="page" data-testid="mock-pg-processed" data-state={session?.state ?? 'missing'}>
      <h1 className="h1">{title}</h1>
      <p className="hint">개발용 결제창이에요. 운영 환경에서는 열리지 않아요.</p>
      <p>{text}</p>
      <a href={href} className="button">
        {label}
      </a>
    </main>
  );
}

export default async function MockPgPage(props: PageProps<'/dev/mock-pg'>) {
  if (!isMockPaymentAllowed()) notFound();
  const q = await props.searchParams;
  const session = typeof q.paymentKey === 'string' ? sharedMockProvider().session(q.paymentKey) : null;
  if (!session || session.state !== 'pending') return <Processed session={session} />;
  return (
    <main className="page" data-testid="mock-pg">
      <h1 className="h1">목 결제창</h1>
      <p className="hint">개발용 결제창이에요. 운영 환경에서는 열리지 않아요. 실제 결제는 PG 계약 뒤에 연결해요.</p>
      <form method="post" action="/api/dev/mock-pg" className="section box" style={{ gap: 12 }}>
        <input type="hidden" name="paymentKey" value={session.paymentKey} />
        <div>{session.orderName}</div>
        <div className="meta">결제 수단 {session.methodCode}</div>
        <label className="field">
          <span className="label">결제 금액 (원)</span>
          <input className="input" name="amount" inputMode="numeric" defaultValue={String(session.requestedAmount)} data-testid="mock-pg-amount" />
        </label>
        {OUTCOMES.map((o, i) => (
          <label key={o.id} className="check">
            <input type="radio" name="outcome" value={o.id} defaultChecked={i === 0} data-testid={`mock-pg-${o.id}`} /> {o.label}
          </label>
        ))}
        <button type="submit" className="button" data-testid="mock-pg-submit">
          인증하기
        </button>
      </form>
    </main>
  );
}
