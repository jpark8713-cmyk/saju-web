// 전체 레이아웃. 글꼴은 외부 CDN 없이 앱에 포함한 Noto Serif KR·Noto Sans KR을 쓴다(화면·PDF 공통, D-025).
import '@fontsource/noto-serif-kr/500.css';
import '@fontsource/noto-serif-kr/700.css';
import '@fontsource/noto-serif-kr/900.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { RehearsalBanner } from '../components/RehearsalBanner';
import { SERVICE } from '../config/business';

export const metadata: Metadata = {
  title: SERVICE.name,
  description: SERVICE.tagline,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // 예행 모드 배너는 화면을 연 뒤 브라우저에서 모드를 묻는다. 레이아웃을 요청마다 그리지 않아 정적 페이지 캐시가 유지된다(D-059)
  return (
    <html lang="ko">
      <body>
        <RehearsalBanner />
        {children}
      </body>
    </html>
  );
}
