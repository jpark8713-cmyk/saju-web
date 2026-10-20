'use client';
// 개발 전용 가짜 결제(D-025). 이 모듈은 Checkout.tsx에서 빌드 시점 상수(NODE_ENV)로 감싸 쓰므로
// 운영 빌드에서는 호출이 지워지고 클라이언트 번들에도 들어가지 않는다(D-026, e2e:prod가 번들을 검사).
import { orderHeaders } from '../../web/session';

export type FakeOutcome = 'success' | 'fail' | 'success-genfail';

const OUTCOMES: { id: FakeOutcome; label: string }[] = [
  { id: 'success', label: '결제 성공' },
  { id: 'fail', label: '결제 실패 (화면 A)' },
  { id: 'success-genfail', label: '결제 성공 후 풀이 생성 실패 (화면 B)' },
];

export async function requestFakePayment(orderId: string, token: string, outcome: FakeOutcome): Promise<{ ok: boolean; paid?: boolean; failureReason?: string | null }> {
  const res = await fetch('/api/dev/fake-payment', {
    method: 'POST',
    headers: orderHeaders(token),
    body: JSON.stringify({ orderId, outcome }),
  });
  const data = (await res.json()) as { paid?: boolean; failureReason?: string | null };
  return { ok: res.ok, ...data };
}

export function DevFakePaymentBox({ outcome, onChange }: { outcome: FakeOutcome; onChange: (o: FakeOutcome) => void }) {
  return (
    <div className="dev-box" data-testid="dev-fake-payment">
      <strong>개발용 가짜 결제</strong>
      <span className="hint">운영 환경에서는 보이지 않아요. 실제 결제는 Phase 4에서 연결해요.</span>
      {OUTCOMES.map((o) => (
        <label key={o.id} className="check">
          <input type="radio" name="fake-outcome" checked={outcome === o.id} onChange={() => onChange(o.id)} data-testid={`fake-${o.id}`} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
