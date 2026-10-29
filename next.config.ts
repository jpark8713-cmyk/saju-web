import type { NextConfig } from 'next';

// next.config를 함수로 두어 Next가 넘겨 주는 단계(phase)를 받는다.
// next dev는 phase-development-server, next build는 phase-production-build로 불린다.
export default function config(phase: string): NextConfig {
  return {
    // 빌드 폴더. 기본 .next. 리뷰어를 동시에 돌릴 때는 리뷰어마다 NEXT_DIST_DIR(.next-r1, .next-r2)을 달리 줘 서로의 빌드 파일이 겹치지 않게 한다(D-035)
    distDir: process.env.NEXT_DIST_DIR || '.next',
    // Playwright(PDF 생성용 Chromium 실행)는 번들하지 않고 Node.js require로 쓴다
    serverExternalPackages: ['playwright', 'playwright-core'],
    // 개발 서버를 127.0.0.1로 열어도 화면 스크립트가 막히지 않게 한다(기본은 localhost만 허용, D-038). 운영 빌드에는 영향이 없다
    allowedDevOrigins: ['127.0.0.1'],
    // 빌드 단계를 번들에 박는다. 운영 빌드인지는 실행 때 바꿀 수 있는 NODE_ENV가 아니라 이 값으로 판단한다(src/config/flags.ts, D-058)
    env: { SAJU_BUILD_PHASE: phase },
  };
}
