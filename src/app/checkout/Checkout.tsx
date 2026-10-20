'use client';
// 화면 5: 주문 요약, 환불 규정 고지와 동의(필수), 결제 수단 목록(1차는 카카오페이만), 결제하기.
// 실제 PG 결제는 Phase 4다. 그 전에는 개발 환경에서만 가짜 결제(성공·실패·생성 실패)를 고를 수 있다.
// 운영(fakePayment=false)에서는 가짜 결제 영역을 그리지 않고 결제하기 버튼도 꺼 둔다. API도 404다(D-025).
// 가짜 결제 코드는 빌드 시점 상수 DEV_BUILD로 감싸 운영 클라이언트 번들에서 빠지게 한다(D-026).
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PAYMENT_METHODS } from '../../config/paymentMethods';
import { REFUND_POLICY_SUMMARY } from '../../config/legal';
import { load, save, type SavedOrder } from '../../web/session';
import { DevFakePaymentBox, requestFakePayment, type FakeOutcome } from './devFakePayment';

/** Next가 빌드할 때 값을 박아 넣는다. 운영 빌드에서는 false라 가짜 결제 코드가 지워진다 */
const DEV_BUILD = process.env.NODE_ENV !== 'production';
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function Checkout({ fakePayment }: { fakePayment: boolean }) {
  const router = useRouter();
  const [order, setOrder] = useState<SavedOrder | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [outcome, setOutcome] = useState<FakeOutcome>('success');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const o = load('saju.order');
    if (!o) router.replace('/preview');
    else setOrder(o);
  }, [router]);

  if (!order) return <p className="meta">불러오는 중이에요…</p>;

  const pay = async () => {
    if (!DEV_BUILD || !fakePayment || !agreed) return;
    setBusy(true);
    setError(null);
    try {
      const data = await requestFakePayment(order.orderId, order.accessToken, outcome);
      if (data.ok && data.paid) {
        router.push(`/orders/${order.orderId}`);
      } else {
        save('saju.payFailure', data.failureReason ?? '결제를 완료하지 못했어요.');
        router.push('/checkout/failed');
      }
    } catch {
      setError('연결이 잠시 끊겼어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section" style={{ gap: 20 }}>
      <section className="box section" aria-label="주문 요약" data-testid="order-summary">
        <div className="meta">주문번호 {order.orderId}</div>
        <div className="total" style={{ fontWeight: 400, fontSize: 14 }}>
          <span>기본 리포트</span>
          <span>{won(order.breakdown.base)}</span>
        </div>
        {order.breakdown.topics.map((t) => (
          <div key={t.id} className="total" style={{ fontWeight: 400, fontSize: 14 }}>
            <span>{t.label} 풀이</span>
            <span>{won(t.price)}</span>
          </div>
        ))}
        {order.breakdown.discount > 0 && (
          <div className="total" style={{ fontWeight: 400, fontSize: 14 }}>
            <span>전체 선택 할인</span>
            <span>-{won(order.breakdown.discount)}</span>
          </div>
        )}
        <div className="total" data-testid="checkout-total">
          <span>결제 금액</span>
          <span>{won(order.amount)}</span>
        </div>
        <div className="hint">받는 방법: {order.deliveryMethods.map((d) => (d === 'pdf' ? 'PDF 다운로드' : '이메일')).join(', ')}</div>
      </section>

      <section className="section" aria-label="환불 규정">
        <div className="section-head">
          <h2 className="h2">환불 규정</h2>
        </div>
        <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
          {REFUND_POLICY_SUMMARY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <label className="check box">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="agree-terms" />
          <span>
            (필수) <a href="/legal/terms" target="_blank" rel="noreferrer">이용약관</a>과{' '}
            <a href="/legal/refund" target="_blank" rel="noreferrer">환불 규정</a>을 확인했고 동의해요.
          </span>
        </label>
      </section>

      <fieldset className="section" style={{ border: 0, padding: 0, margin: 0 }} aria-label="결제 수단">
        <legend className="h2" style={{ marginBottom: 8 }}>
          결제 수단
        </legend>
        {(['easy', 'other'] as const).map((group) => (
          <div key={group} className="field">
            <div className="hint">{group === 'easy' ? '간편결제' : '그 외'}</div>
            {PAYMENT_METHODS.filter((m) => m.group === group).map((m) => (
              <label key={m.id} className="check" data-testid={`method-${m.id}`}>
                <input type="radio" name="method" value={m.id} disabled={!m.enabled} checked={m.id === order.paymentMethod} readOnly />
                <span>{m.name}</span>
                {!m.enabled && <span className="hint">준비 중</span>}
              </label>
            ))}
          </div>
        ))}
      </fieldset>

      {DEV_BUILD && fakePayment ? (
        <DevFakePaymentBox outcome={outcome} onChange={setOutcome} />
      ) : (
        <p className="hint" style={{ margin: 0 }} data-testid="payment-not-ready">
          결제 연동을 준비하고 있어요. 지금은 결제할 수 없어요.
        </p>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="button" disabled={!DEV_BUILD || !fakePayment || !agreed || busy} onClick={() => void pay()} data-testid="pay-button">
        {won(order.amount)} 결제하기
      </button>
      <a href="/preview">미리보기로 돌아가기</a>
    </div>
  );
}
