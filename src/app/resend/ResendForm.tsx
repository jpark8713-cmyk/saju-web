'use client';
// 화면 C: 링크 다시 받기. 응답은 주문·이메일 일치 여부와 관계없이 같은 문구다(주문 존재 여부를 드러내지 않는다).
import { useState } from 'react';

const ORDER_RE = /^SJ\d{8}-[A-HJ-NP-Z2-9]{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ResendForm() {
  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState({ orderId: false, email: false });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const orderOk = ORDER_RE.test(orderId.trim());
  const emailOk = EMAIL_RE.test(email.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderOk || !emailOk) return;
    setBusy(true);
    try {
      const res = await fetch('/api/delivery/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: orderId.trim(), email: email.trim() }),
      });
      setMessage(((await res.json()) as { message?: string }).message ?? null);
    } catch {
      setMessage('연결이 잠시 끊겼어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="section" onSubmit={submit} noValidate data-testid="resend-form" style={{ gap: 18 }}>
      <div className="field">
        <label className="label" htmlFor="resend-order">
          주문번호
        </label>
        <input id="resend-order" className="input" value={orderId} data-testid="resend-order-id"
          onChange={(e) => { setOrderId(e.target.value); setTouched((t) => ({ ...t, orderId: true })); }} />
        {touched.orderId && !orderOk && <div className="error" role="alert">주문번호 형식이 올바르지 않습니다. (예: SJ20261020-ABCD2345)</div>}
      </div>
      <div className="field">
        <label className="label" htmlFor="resend-email">
          주문할 때 입력한 이메일
        </label>
        <input id="resend-email" className="input" type="email" inputMode="email" value={email} data-testid="resend-email"
          onChange={(e) => { setEmail(e.target.value); setTouched((t) => ({ ...t, email: true })); }} />
        {touched.email && !emailOk && <div className="error" role="alert">이메일 주소를 정확히 입력해 주세요.</div>}
      </div>
      <button type="submit" className="button" disabled={!orderOk || !emailOk || busy} data-testid="resend-submit">
        새 링크 받기
      </button>
      {message && (
        <div className="box" role="status" data-testid="resend-message">
          {message}
        </div>
      )}
    </form>
  );
}
