// 전체 레이아웃. 글꼴은 외부 CDN 없이 앱에 포함한 Noto Serif KR·Noto Sans KR을 쓴다(화면·PDF 공통, D-025).
import '@fontsource/noto-serif-kr/500.css';
import '@fontsource/noto-serif-kr/700.css';
import '@fontsource/noto-serif-kr/900.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // 예행 모드 배너는 빌드 때가 아니라 서버를 띄울 때의 환경변수(REHEARSAL_MODE)로 정해야 해서, 화면을 요청마다 그린다(D-058)
  await connection();
  return (
    <html lang="ko">
      <body>
        <RehearsalBanner />
        {children}
      </body>
    </html>
  );
}
