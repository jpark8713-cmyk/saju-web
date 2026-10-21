'use client';
// 화면 A: 결제 실패. 사유를 보여 주고 다시 결제하거나 미리보기로 돌아간다(입력 정보는 이 탭에 그대로 남아 있다).
// PG가 실패 복귀 주소로 보낸 경우 주소의 code를 정해진 문구로만 바꾼다.
import { useEffect, useState } from 'react';
import { payFailureMessage } from '../../../web/paymentMessages';
import { load } from '../../../web/session';

export function PayFailed({ code }: { code: string | null }) {
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => setReason(code ? payFailureMessage(code) : load('saju.payFailure')), [code]);
  return (
    <div className="section">
      <h1 className="h1">결제가 완료되지 않았어요</h1>
      <div className="box" data-testid="pay-failure-reason">
        {reason ?? payFailureMessage(null)}
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
