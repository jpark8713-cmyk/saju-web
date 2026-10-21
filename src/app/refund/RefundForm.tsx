'use client';
// 화면 D: 환불 요청 입력. 주문번호·이메일 형식이 맞지 않으면 버튼을 끄고 칸 아래에 문구를 보여 준다.
// 이름·생년월일·전화번호는 받지 않는다.
// 본인 확인(D-028): 이 탭에 그 주문의 토큰이 있으면 함께 보낸다. 없으면 주문할 때 입력한 이메일(이메일로 받기 주문)로 확인한다.
// PDF로만 받은 주문을 다른 기기에서 접수하려면 고객센터 이메일로 보내도록 안내한다.
// 회신받을 이메일은 이 환불 건에만 저장한다.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BUSINESS } from '../../config/business';
import { REFUND_DETAIL_MAX, REFUND_REASONS } from '../../orders/refundForm';
import { load, orderHeaders } from '../../web/session';

const ORDER_RE = /^SJ\d{8}-[A-HJ-NP-Z2-9]{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Reason = (typeof REFUND_REASONS)[number]['id'];

export function RefundForm({ initialOrderId }: { initialOrderId: string }) {
  const router = useRouter();
  const [orderId, setOrderId] = useState(initialOrderId);
  const [reason, setReason] = useState<Reason>('not_generated');
  const [detail, setDetail] = useState('');
  const [email, setEmail] = useState('');
  const [orderEmail, setOrderEmail] = useState('');
  const [touched, setTouched] = useState({ orderId: !!initialOrderId, email: false, orderEmail: false });
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** 이 탭이 가진 주문 토큰 (주문번호가 같을 때만 쓴다) */
  const [device, setDevice] = useState<{ orderId: string; token: string } | null>(null);

  useEffect(() => {
    const saved = load('saju.order');
    if (saved) setDevice({ orderId: saved.orderId, token: saved.accessToken });
  }, []);

  const id = orderId.trim();
  const deviceToken = device && device.orderId === id ? device.token : null;
  const orderOk = ORDER_RE.test(id);
  const emailOk = EMAIL_RE.test(email.trim());
  const orderEmailOk = orderEmail.trim() === '' || EMAIL_RE.test(orderEmail.trim());
  const detailOk = detail.length <= REFUND_DETAIL_MAX;
  const canSubmit = orderOk && emailOk && orderEmailOk && detailOk && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setServerErrors({});
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/refund-request`, {
        method: 'POST',
        headers: deviceToken ? orderHeaders(deviceToken) : { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: id, reason, detail, email, orderEmail: deviceToken ? null : orderEmail || null }),
      });
      const data = await res.json();
      if (res.status === 202) {
        router.push(`/refund/done?refundId=${encodeURIComponent(data.refundId)}&orderId=${encodeURIComponent(data.orderId)}`);
      } else if (res.status === 429) {
        setServerErrors({ form: '요청이 너무 많아요. 한 시간쯤 뒤에 다시 시도해 주세요.' });
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
  const orderEmailError = serverErrors.orderEmail ?? (touched.orderEmail && !orderEmailOk ? '주문할 때 입력한 이메일 주소를 정확히 입력해 주세요.' : undefined);

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

      {deviceToken ? (
        <p className="hint" style={{ margin: 0 }} data-testid="refund-device-verified">
          이 브라우저에서 결제한 주문이라 따로 확인할 정보가 없어요.
        </p>
      ) : (
        <div className="field" data-testid="refund-order-email-field">
          <label className="label" htmlFor="refund-order-email">
            주문할 때 입력한 이메일 <span className="hint">(이메일로 받기를 고른 주문)</span>
          </label>
          <input id="refund-order-email" className="input" type="email" inputMode="email" value={orderEmail} data-testid="refund-order-email"
            onChange={(e) => { setOrderEmail(e.target.value); setTouched((t) => ({ ...t, orderEmail: true })); }} aria-describedby="refund-order-email-error" />
          {orderEmailError && <div className="error" id="refund-order-email-error" role="alert">{orderEmailError}</div>}
          <span className="hint" data-testid="refund-other-device">
            PDF로만 받은 주문은 결제한 브라우저에서만 여기서 접수할 수 있어요. 기기를 바꾸셨다면 고객센터 이메일({BUSINESS.supportEmail})로 주문번호와
            결제 내역(결제 일시와 금액이 보이는 화면)을 보내 주세요. 운영자가 확인해 직접 처리해 드려요.
          </span>
        </div>
      )}

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
        <span className="hint">이 환불 요청의 안내에만 쓰고, 처리가 끝나면 삭제해요. 주문 정보에는 저장하지 않아요.</span>
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
