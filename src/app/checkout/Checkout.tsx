'use client';
// 화면 5: 주문 요약, 환불 규정 고지와 동의(필수), 결제 수단 고르기, 결제하기.
// 결제하기를 누르면 서버가 결제창 주소를 주고(POST /api/payments/prepare), 브라우저가 그 결제창으로 이동한다.
// 결제창에서 돌아오면 /checkout/complete가 서버에 승인을 요청한다. 금액은 서버가 정한다.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PaymentMethod } from '../../config/paymentMethods';
import { DOWNLOAD_LINK_TTL_TEXT } from '../../config/delivery';
import { REFUND_POLICY_SUMMARY } from '../../config/legal';
import { payFailureMessage } from '../../web/paymentMessages';
import { load, orderHeaders, save, type SavedOrder } from '../../web/session';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function Checkout({ methods, paymentReady }: { methods: PaymentMethod[]; paymentReady: boolean }) {
  const router = useRouter();
  const [order, setOrder] = useState<SavedOrder | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [method, setMethod] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const o = load('saju.order');
    if (!o) {
      router.replace('/preview');
      return;
    }
    setOrder(o);
    const saved = methods.find((m) => m.id === o.paymentMethod && m.enabled);
    setMethod(saved?.id ?? methods.find((m) => m.enabled)?.id ?? '');
  }, [router, methods]);

  if (!order) return <p className="meta">불러오는 중이에요…</p>;

  const canPay = paymentReady && agreed && !!method && !busy;

  const pay = async () => {
    if (!canPay) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/payments/prepare', {
        method: 'POST',
        headers: orderHeaders(order.accessToken),
        body: JSON.stringify({ orderId: order.orderId, paymentMethod: method }),
      });
      const data = (await res.json()) as { redirectUrl?: string; error?: string; code?: string };
      if (res.ok && data.redirectUrl) {
        save('saju.order', { ...order, paymentMethod: method });
        window.location.assign(data.redirectUrl);
        return;
      }
      if (data.error === 'already_paid') {
        router.push(`/orders/${order.orderId}`);
        return;
      }
      // 거절 이유가 있으면 그 문구로(예: 주문 30일이 지나 출생 정보를 지운 주문은 새로 주문하라고 안내, D-054)
      if (data.error === 'payment_rejected' && data.code) {
        setError(payFailureMessage(data.code));
        return;
      }
      setError(res.status === 409 ? '결제를 처리하고 있어요. 잠시 후 다시 시도해 주세요.' : '결제를 시작하지 못했어요. 다시 시도해 주세요.');
    } catch {
      setError('연결이 잠시 끊겼어요. 다시 시도해 주세요.');
    }
    setBusy(false);
  };

  return (
    <div className="section" style={{ gap: 20 }}>
      <section className="box section" aria-label="주문 요약" data-testid="order-summary">
        <div className="meta">주문번호 {order.orderId}</div>
        <div className="total" style={{ fontWeight: 400, fontSize: 14 }}>
          <span>기본 리포트</span>
          <span>{won(order.breakdown.base)}</span>
        </div>
        {!!order.breakdown.periods && (
          <div className="total" style={{ fontWeight: 400, fontSize: 14 }}>
            <span>월별·10년 흐름</span>
            <span>{won(order.breakdown.periods)}</span>
          </div>
        )}
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
        <div className="hint" data-testid="checkout-retention">
          PDF와 {order.deliveryMethods.includes('email') ? '이메일 다운로드 링크는' : '리포트는'} 리포트가 완성된 날부터 <strong>{DOWNLOAD_LINK_TTL_TEXT}</strong> 동안
          받을 수 있어요. 그 뒤에는 PDF·리포트{order.deliveryMethods.includes('email') ? '·이메일 주소' : ''}를 삭제해요.
        </div>
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
            {methods.filter((m) => m.group === group).map((m) => (
              <label key={m.id} className="check" data-testid={`method-${m.id}`}>
                <input type="radio" name="method" value={m.id} disabled={!m.enabled} checked={m.id === method} onChange={() => setMethod(m.id)} />
                <span>{m.name}</span>
                {!m.enabled && <span className="hint">준비 중</span>}
              </label>
            ))}
          </div>
        ))}
      </fieldset>

      {!paymentReady && (
        <p className="hint" style={{ margin: 0 }} data-testid="payment-not-ready">
          결제 연동을 준비하고 있어요. 지금은 결제할 수 없어요.
        </p>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="button" disabled={!canPay} onClick={() => void pay()} data-testid="pay-button">
        {won(order.amount)} 결제하기
      </button>
      <a href="/preview">미리보기로 돌아가기</a>
    </div>
  );
}
