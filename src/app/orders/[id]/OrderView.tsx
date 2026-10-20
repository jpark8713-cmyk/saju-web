'use client';
// 화면 6(생성 중) → 화면 7(리포트 받기) / 화면 B(생성 실패).
// 미리보기와 같은 리포트 템플릿(ReportDocument)을 쓰므로, 결제 후 잠겼던 섹션이 같은 자리에서 열린다.
// 생성은 결제가 확인된 주문만 서버가 시작한다(결제 전이면 409).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReportDocument } from '../../../components/ReportDocument';
import type { ReportView } from '../../../report/view';
import { load, orderHeaders, remove, type SavedOrder } from '../../../web/session';

type Stage = 'payment' | 'writing' | 'done' | 'failed';
interface StatusView {
  stage: Stage;
  runs: number;
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

function Failed({ orderId, onRetry, autoRetryPending, busy }: { orderId: string; onRetry: () => void; autoRetryPending: boolean; busy: boolean }) {
  return (
    <section className="section" data-testid="screen-generation-failed">
      <h1 className="h1">풀이를 만들지 못했어요</h1>
      <p style={{ margin: 0 }}>잠깐 문제가 생겼어요. 결제는 확인됐고, 다시 시도하면 새로 만들어요.</p>
      {autoRetryPending && (
        <p className="meta" style={{ margin: 0 }} data-testid="auto-retry-notice">
          10초 뒤에 자동으로 한 번 더 시도해요.
        </p>
      )}
      <button type="button" className="button" onClick={onRetry} disabled={busy} data-testid="retry-now">
        지금 다시 시도
      </button>
      <a href={`/refund?orderId=${encodeURIComponent(orderId)}`} className="button secondary" data-testid="go-refund">
        환불 요청
      </a>
      <div className="box">
        주문번호 <strong>{orderId}</strong>
      </div>
    </section>
  );
}

function Delivery({ order, token }: { order: SavedOrder; token: string }) {
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
        <div data-testid="email-status">
          <p style={{ margin: 0 }}>이메일 발송: 준비 중이에요. 메일 발송 기능을 연결하면 입력하신 주소로 다운로드 링크를 보내 드려요.</p>
          <a href="/resend">링크 다시 받기</a>
        </div>
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

  const poll = useCallback(async (mine: number) => {
    if (!token || mine !== seq.current) return;
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { headers: orderHeaders(token), cache: 'no-store' });
    if (!res.ok || mine !== seq.current) return;
    const s = (await res.json()) as StatusView;
    setStatus(s);
    if (s.stage === 'done') {
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
    if (s.stage === 'failed') return;
    pollTimer.current = setTimeout(() => void poll(mine), POLL_MS);
  }, [orderId, token]);

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
    if (status?.stage !== 'failed' || status.runs > AUTO_RETRY_LIMIT_RUNS) {
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
        <Delivery order={order} token={order.accessToken} />
      </div>
    );
  }
  if (status?.stage === 'failed') {
    return <Failed orderId={orderId} onRetry={() => void start()} autoRetryPending={autoRetryPending} busy={busy} />;
  }
  return <Progress stage={status?.stage ?? 'payment'} orderId={orderId} email={order.deliveryMethods.includes('email')} />;
}
