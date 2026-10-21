'use client';
// 결제 승인 요청. 결제창이 돌려준 결제 키·금액을 서버에 넘기고, 서버가 주문 금액으로 PG에 승인을 요청한다.
// 승인되면 화면 6(생성)으로, 거부되면 화면 A(결제 실패)로 간다. 새로고침으로 다시 보내도 결제는 한 번만 승인된다.
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { payFailureMessage } from '../../../web/paymentMessages';
import { load, orderHeaders, save } from '../../../web/session';

export function ConfirmPayment({ orderId, paymentKey, amount }: { orderId: string; paymentKey: string; amount: string }) {
  const router = useRouter();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const order = load('saju.order');
    if (!order || order.orderId !== orderId) {
      router.replace(`/orders/${encodeURIComponent(orderId)}`);
      return;
    }
    const fail = (code: string | null) => {
      save('saju.payFailure', payFailureMessage(code));
      router.replace('/checkout/failed');
    };
    void (async () => {
      try {
        const res = await fetch('/api/payments/confirm', {
          method: 'POST',
          headers: orderHeaders(order.accessToken),
          body: JSON.stringify({ orderId, paymentKey, amount: Number(amount) }),
        });
        const data = (await res.json()) as { paid?: boolean; code?: string; error?: string };
        if (res.ok && data.paid) router.replace(`/orders/${encodeURIComponent(orderId)}`);
        else if (data.error === 'payment_in_progress') router.replace(`/orders/${encodeURIComponent(orderId)}`);
        else fail(data.code ?? null);
      } catch {
        fail('PG_UNREACHABLE');
      }
    })();
  }, [orderId, paymentKey, amount, router]);

  return (
    <section className="section" aria-live="polite">
      <h1 className="h1">결제를 확인하고 있어요</h1>
      <p className="meta" style={{ margin: 0 }}>
        이 화면을 닫지 말고 잠시만 기다려 주세요.
      </p>
    </section>
  );
}
