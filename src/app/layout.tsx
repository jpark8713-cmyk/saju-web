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
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
