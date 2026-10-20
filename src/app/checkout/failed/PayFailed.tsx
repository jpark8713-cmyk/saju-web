'use client';
// 화면 A: 결제 실패. 사유를 보여 주고 다시 결제하거나 미리보기로 돌아간다(입력 정보는 이 탭에 그대로 남아 있다).
import { useEffect, useState } from 'react';
import { load } from '../../../web/session';

export function PayFailed() {
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => setReason(load('saju.payFailure')), []);
  return (
    <div className="section">
      <h1 className="h1">결제가 완료되지 않았어요</h1>
      <div className="box" data-testid="pay-failure-reason">
        {reason ?? '결제 화면이 닫혔거나 승인되지 않았어요.'}
      </div>
      <p className="meta" style={{ margin: 0 }}>
        입력하신 정보와 고른 주제는 그대로 남아 있어요.
      </p>
      <a href="/checkout" className="button" data-testid="retry-payment">
        다시 결제하기
      </a>
      <a href="/preview" className="button secondary">
        미리보기로 돌아가기
      </a>
    </div>
  );
}
