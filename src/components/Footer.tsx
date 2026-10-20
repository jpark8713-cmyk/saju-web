// 공통 푸터: 사업자 정보와 약관·환불·처리방침 링크(모든 화면 하단, PG·카카오페이 심사 항목).
import Link from 'next/link';
import { BUSINESS } from '../config/business';

export function Footer() {
  return (
    <footer className="footer" data-testid="site-footer">
      <div>
        상호 {BUSINESS.companyName} · 대표자 {BUSINESS.representative}
      </div>
      <div>
        사업자등록번호 {BUSINESS.registrationNumber} · 통신판매업 신고번호 {BUSINESS.mailOrderNumber}
      </div>
      <div>
        주소 {BUSINESS.address} · 연락처 {BUSINESS.contact}
      </div>
      <nav className="footer-links" aria-label="약관 및 정책">
        <Link href="/legal/terms">이용약관</Link>
        <Link href="/legal/refund">환불 규정</Link>
        <Link href="/legal/privacy">개인정보 처리방침</Link>
      </nav>
    </footer>
  );
}
