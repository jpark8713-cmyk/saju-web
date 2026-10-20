'use client';
// 화면 D: 환불 요청 입력. 주문번호·이메일 형식이 맞지 않으면 버튼을 끄고 칸 아래에 문구를 보여 준다.
// 이름·생년월일·전화번호는 받지 않는다. 이메일은 환불 안내에만 쓴다.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { REFUND_DETAIL_MAX, REFUND_REASONS } from '../../orders/refundForm';

const ORDER_RE = /^SJ\d{8}-[A-HJ-NP-Z2-9]{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Reason = (typeof REFUND_REASONS)[number]['id'];

export function RefundForm({ initialOrderId }: { initialOrderId: string }) {
  const router = useRouter();
  const [orderId, setOrderId] = useState(initialOrderId);
  const [reason, setReason] = useState<Reason>('not_generated');
  const [detail, setDetail] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState({ orderId: !!initialOrderId, email: false });
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const orderOk = ORDER_RE.test(orderId.trim());
  const emailOk = EMAIL_RE.test(email.trim());
  const detailOk = detail.length <= REFUND_DETAIL_MAX;
  const canSubmit = orderOk && emailOk && detailOk && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setServerErrors({});
    try {
      const id = orderId.trim();
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/refund-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: id, reason, detail, email }),
      });
      const data = await res.json();
      if (res.status === 201) {
        router.push(`/refund/done?refundId=${encodeURIComponent(data.refundId)}&orderId=${encodeURIComponent(data.orderId)}`);
      } else {
        setServerErrors(data.errors ?? { form: '접수하지 못했어요. 잠시 후 다시 시도해 주세요.' });
      }
    } catch {
      setServerErrors({ form: '연결이 잠시 끊겼어요. 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  const orderError = serverErrors.orderId ?? (touched.orderId && !orderOk ? '주문번호 형식이 올바르지 않습니다. (예: SJ20261020-ABCD2345)' : undefined);
  const emailError = serverErrors.email ?? (touched.email && !emailOk ? '처리 결과를 받을 이메일 주소를 정확히 입력해 주세요.' : undefined);

  return (
    <form className="section" onSubmit={submit} noValidate data-testid="refund-form" style={{ gap: 18 }}>
      <div className="field">
        <label className="label" htmlFor="orderId">
          주문번호
        </label>
        <input id="orderId" className="input" value={orderId} data-testid="refund-order-id"
          onChange={(e) => { setOrderId(e.target.value); setTouched((t) => ({ ...t, orderId: true })); }} aria-describedby="orderId-error" />
        {orderError && <div className="error" id="orderId-error" role="alert">{orderError}</div>}
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">사유</legend>
        {REFUND_REASONS.map((r) => (
          <label key={r.id} className="check">
            <input type="radio" name="reason" checked={reason === r.id} onChange={() => setReason(r.id)} /> {r.label}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label className="label" htmlFor="detail">
          상세 내용 <span className="hint">(선택, {REFUND_DETAIL_MAX}자 이내)</span>
        </label>
        <textarea id="detail" className="textarea" rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} />
        {(!detailOk || serverErrors.detail) && <div className="error" role="alert">{serverErrors.detail ?? `상세 내용은 ${REFUND_DETAIL_MAX}자 이내로 적어 주세요.`}</div>}
      </div>
      <div className="field">
        <label className="label" htmlFor="refund-email">
          처리 결과 받을 이메일
        </label>
        <input id="refund-email" className="input" type="email" inputMode="email" value={email} data-testid="refund-email"
          onChange={(e) => { setEmail(e.target.value); setTouched((t) => ({ ...t, email: true })); }} aria-describedby="refund-email-error" />
        {emailError && <div className="error" id="refund-email-error" role="alert">{emailError}</div>}
        <span className="hint">환불 안내에만 쓰고 처리가 끝나면 삭제해요.</span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        리포트를 이미 받은 주문도 접수할 수 있어요. 이때 환불 가능 여부는 환불 규정과 발행 기록을 보고 운영자가 판단해요.
      </p>
      {serverErrors.form && <div className="error" role="alert">{serverErrors.form}</div>}
      <button type="submit" className="button" disabled={!canSubmit} data-testid="refund-submit">
        환불 요청하기
      </button>
    </form>
  );
}
