'use client';
// 화면 6(생성 중) → 화면 7(리포트 받기) / 화면 B(생성 실패).
// 미리보기와 같은 리포트 템플릿(ReportDocument)을 쓰므로, 결제 후 잠겼던 섹션이 같은 자리에서 열린다.
// 생성은 결제가 확인된 주문만 서버가 시작한다(결제 전이면 409).
// 시도 횟수를 다 쓰면(서버 MAX_GENERATION_RUNS) 다시 시도 대신 환불 안내를 보여 준다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReportDocument } from '../../../components/ReportDocument';
import { DOWNLOAD_LINK_TTL_TEXT, koreanDate } from '../../../config/delivery';
import type { ReportView } from '../../../report/view';
import { load, orderHeaders, remove, type SavedOrder } from '../../../web/session';

type Stage = 'payment' | 'writing' | 'done' | 'failed' | 'refunded' | 'expired';
type EmailStatus = 'none' | 'sending' | 'sent' | 'failed';
interface StatusView {
  stage: Stage;
  deliveryMethods: ('pdf' | 'email')[];
  runs: number;
  canRetry: boolean;
  expiresAt: string | null;
  emailStatus: EmailStatus;
}

export const POLL_MS = 1_500;
export const AUTO_RETRY_MS = 10_000;
/** 자동 재시도는 한 번만 (첫 실행 + 자동 1회) */
const AUTO_RETRY_LIMIT_RUNS = 1;

const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'payment', label: '결제 확인' },
  { stage: 'writing', label: '풀이 작성' },
  { stage: 'done', label: '완료' },
];

function Progress({ stage, orderId, email }: { stage: Stage; orderId: string; email: boolean }) {
  const current = STEPS.findIndex((s) => s.stage === stage);
  return (
    <section className="section" data-testid="screen-generating" aria-live="polite">
      <h1 className="h1">풀이를 쓰고 있어요</h1>
      <ol className="sentences">
        {STEPS.map((s, i) => (
          <li key={s.stage} style={{ fontWeight: i === current ? 700 : 400, color: i > current ? 'var(--muted)' : undefined }}>
            {i < current ? '✓ ' : i === current ? '● ' : '○ '}
            {s.label}
          </li>
        ))}
      </ol>
      <p className="meta" style={{ margin: 0 }}>
        보통 20~30초 걸려요. 이 화면을 닫아도 풀이는 계속 만들어져요.
        {email ? ' 완료되면 입력하신 이메일로 링크를 보내 드려요.' : ''}
      </p>
      <div className="box">
        주문번호 <strong data-testid="order-id">{orderId}</strong>
      </div>
    </section>
  );
}

function Failed({ orderId, onRetry, autoRetryPending, busy, canRetry }: { orderId: string; onRetry: () => void; autoRetryPending: boolean; busy: boolean; canRetry: boolean }) {
  return (
    <section className="section" data-testid="screen-generation-failed">
      <h1 className="h1">풀이를 만들지 못했어요</h1>
      {canRetry ? (
        <p style={{ margin: 0 }}>잠깐 문제가 생겼어요. 결제는 확인됐고, 다시 시도하면 새로 만들어요.</p>
      ) : (
        <p style={{ margin: 0 }} data-testid="retry-exhausted">
          여러 번 시도했지만 풀이를 만들지 못했어요. 환불 요청을 남겨 주시면 결제하신 금액을 전액 돌려드려요.
        </p>
      )}
      {canRetry && autoRetryPending && (
        <p className="meta" style={{ margin: 0 }} data-testid="auto-retry-notice">
          10초 뒤에 자동으로 한 번 더 시도해요.
        </p>
      )}
      {canRetry && (
        <button type="button" className="button" onClick={onRetry} disabled={busy} data-testid="retry-now">
          지금 다시 시도
        </button>
      )}
      <a href={`/refund?orderId=${encodeURIComponent(orderId)}`} className="button secondary" data-testid="go-refund">
        환불 요청
      </a>
      <div className="box">
        주문번호 <strong>{orderId}</strong>
      </div>
    </section>
  );
}

function EmailStatusLine({ status }: { status: EmailStatus }) {
  if (status === 'sent') return <p style={{ margin: 0 }}>입력하신 이메일로 다운로드 링크를 보냈어요.</p>;
  if (status === 'failed')
    return (
      <p style={{ margin: 0 }}>
        이메일을 보내지 못했어요. 이 화면에서 PDF를 받거나, 잠시 뒤 <a href="/resend">링크 다시 받기</a>를 해 주세요.
      </p>
    );
  return <p style={{ margin: 0 }}>다운로드 링크를 이메일로 보내고 있어요.</p>;
}

function Delivery({ order, token, status }: { order: SavedOrder; token: string; status: StatusView | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(order.orderId)}/pdf`, { headers: orderHeaders(token) });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `saju-report-${order.orderId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError('PDF를 만들지 못했어요. 잠시 후 다시 눌러 주세요.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section box no-print" data-testid="delivery-box" aria-label="리포트 받기">
      <h2 className="h2">리포트 받기</h2>
      {order.deliveryMethods.includes('pdf') && (
        <button type="button" className="button" onClick={() => void download()} disabled={busy} data-testid="pdf-download">
          {busy ? 'PDF 만드는 중…' : 'PDF 다운로드'}
        </button>
      )}
      {order.deliveryMethods.includes('email') && (
        <div data-testid="email-status" data-email-status={status?.emailStatus ?? 'none'}>
          <EmailStatusLine status={status?.emailStatus ?? 'sending'} />
          <a href="/resend">링크 다시 받기</a>
        </div>
      )}
      {status?.expiresAt && (
        <p className="hint" style={{ margin: 0 }} data-testid="delivery-expiry">
          {koreanDate(status.expiresAt)}까지(완성일부터 {DOWNLOAD_LINK_TTL_TEXT}) PDF{order.deliveryMethods.includes('email') ? '와 이메일 링크' : ''}를 받을 수 있어요. 그 뒤에는
          PDF·리포트{order.deliveryMethods.includes('email') ? '·이메일 주소' : ''}를 삭제해요.
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

export function OrderView({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<SavedOrder | null | 'missing'>(null);
  const [status, setStatus] = useState<StatusView | null>(null);
  const [report, setReport] = useState<ReportView | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoRetryPending, setAutoRetryPending] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 새로 시작할 때마다 번호를 올려, 이전 조회 흐름이 남아 있어도 이어지지 않게 한다
  const seq = useRef(0);
  const token = order && order !== 'missing' ? order.accessToken : null;

  useEffect(() => {
    const saved = load('saju.order');
    setOrder(saved && saved.orderId === orderId ? saved : 'missing');
  }, [orderId]);

  /** 리포트를 받은 뒤 이메일 발송 상태만 다시 본다(최대 40번) */
  const emailPolls = useRef(0);
  const refreshStatus = useCallback(async (mine: number) => {
    if (!token || mine !== seq.current || emailPolls.current++ > 40) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { headers: orderHeaders(token), cache: 'no-store' });
    if (!res.ok || mine !== seq.current) return;
    const s = (await res.json()) as StatusView;
    setStatus(s);
    if (s.emailStatus === 'sending' || s.emailStatus === 'none') pollTimer.current = setTimeout(() => void refreshStatus(mine), POLL_MS);
  }, [orderId, token]);

  const poll = useCallback(async (mine: number) => {
    if (!token || mine !== seq.current) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { headers: orderHeaders(token), cache: 'no-store' });
    if (!res.ok || mine !== seq.current) return;
    const s = (await res.json()) as StatusView;
    setStatus(s);
    if (s.stage === 'done') {
      // 이메일을 보내는 중이면 결과가 나올 때까지 상태만 몇 번 더 본다
      if (s.emailStatus === 'sending' || (s.deliveryMethods.includes('email') && s.emailStatus === 'none')) {
        pollTimer.current = setTimeout(() => void refreshStatus(mine), POLL_MS);
      }
      const r = await fetch(`/api/reports/${encodeURIComponent(orderId)}`, { headers: orderHeaders(token), cache: 'no-store' });
      if (r.ok) {
        setReport(((await r.json()) as { report: ReportView }).report);
        // 리포트를 받았으면 이 탭에 남은 입력값(생년월일시·이름)과 미리보기도 지운다. 주문 토큰은 PDF 다운로드에 필요해 남긴다
        remove('saju.birth');
        remove('saju.preview');
        remove('saju.choices');
      }
      return;
    }
    if (s.stage === 'failed' || s.stage === 'refunded' || s.stage === 'expired') return;
    pollTimer.current = setTimeout(() => void poll(mine), POLL_MS);
  }, [orderId, token, refreshStatus]);

  const start = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setBusy(true);
    try {
      const res = await fetch('/api/reports/generate', { method: 'POST', headers: orderHeaders(token), body: JSON.stringify({ orderId }) });
      if (res.status === 202) setStatus((await res.json()) as StatusView);
    } finally {
      setBusy(false);
    }
    void poll(mine);
  }, [orderId, token, poll]);

  useEffect(() => {
    void start();
    return () => {
      seq.current += 1;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [start]);

  // 화면 B: 처음 실패하면 10초 뒤 한 번만 자동으로 다시 시도한다
  useEffect(() => {
    if (status?.stage !== 'failed' || !status.canRetry || status.runs > AUTO_RETRY_LIMIT_RUNS) {
      setAutoRetryPending(false);
      return;
    }
    setAutoRetryPending(true);
    const t = setTimeout(() => void start(), AUTO_RETRY_MS);
    return () => clearTimeout(t);
  }, [status, start]);

  if (order === null) return <p className="meta">불러오는 중이에요…</p>;
  if (order === 'missing') {
    return (
      <section className="section" data-testid="order-not-here">
        <h1 className="h1">이 브라우저에서 만든 주문이 아니에요</h1>
        <p style={{ margin: 0 }}>주문번호와 이메일로 다운로드 링크를 다시 받을 수 있어요.</p>
        <a href="/resend" className="button">
          링크 다시 받기
        </a>
      </section>
    );
  }
  if (report) {
    return (
      <div className="section" data-testid="screen-report" style={{ gap: 20 }}>
        <ReportDocument view={report} mode="screen" />
        <Delivery order={order} token={order.accessToken} status={status} />
      </div>
    );
  }
  if (status?.stage === 'expired') {
    return (
      <section className="section" data-testid="screen-expired">
        <h1 className="h1">보관 기간이 지난 주문이에요</h1>
        <p style={{ margin: 0 }}>리포트가 완성된 날부터 {DOWNLOAD_LINK_TTL_TEXT}이 지나 PDF·리포트·이메일 주소를 삭제했어요.</p>
        <div className="box">
          주문번호 <strong>{orderId}</strong>
        </div>
      </section>
    );
  }
  if (status?.stage === 'refunded') {
    return (
      <section className="section" data-testid="screen-refunded">
        <h1 className="h1">환불된 주문이에요</h1>
        <p style={{ margin: 0 }}>이 주문은 환불 처리됐어요. 결제 취소 내역은 결제하신 수단에서 확인할 수 있어요.</p>
        <div className="box">
          주문번호 <strong>{orderId}</strong>
        </div>
      </section>
    );
  }
  if (status?.stage === 'failed') {
    return <Failed orderId={orderId} onRetry={() => void start()} autoRetryPending={autoRetryPending} busy={busy} canRetry={status.canRetry} />;
  }
  return <Progress stage={status?.stage ?? 'payment'} orderId={orderId} email={order.deliveryMethods.includes('email')} />;
}
