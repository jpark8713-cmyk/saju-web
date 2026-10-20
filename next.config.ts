import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Playwright(PDF 생성용 Chromium 실행)는 번들하지 않고 Node.js require로 쓴다
  serverExternalPackages: ['playwright', 'playwright-core'],
};

export default nextConfig;
