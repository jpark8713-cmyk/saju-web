import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 빌드 폴더. 기본 .next. 리뷰어를 동시에 돌릴 때는 리뷰어마다 NEXT_DIST_DIR(.next-r1, .next-r2)을 달리 줘 서로의 빌드 파일이 겹치지 않게 한다(D-035)
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Playwright(PDF 생성용 Chromium 실행)는 번들하지 않고 Node.js require로 쓴다
  serverExternalPackages: ['playwright', 'playwright-core'],
};

export default nextConfig;
