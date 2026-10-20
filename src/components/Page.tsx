// 모든 화면의 공통 틀: 내용 + 공통 푸터. 상단 "주문 조회"는 링크 다시 받기(화면 C)로 연결한다(SPEC 1-1장).
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SERVICE } from '../config/business';
import { Footer } from './Footer';

export function Page({ children, testId, showOrderLookup = true }: { children: ReactNode; testId: string; showOrderLookup?: boolean }) {
  return (
    <main className="page" data-testid={testId}>
      <div className="masthead-row no-print">
        <Link href="/" className="service-name" style={{ textDecoration: 'none' }}>
          {SERVICE.name}
        </Link>
        {showOrderLookup && <Link href="/resend">주문 조회</Link>}
      </div>
      {children}
      <Footer />
    </main>
  );
}
