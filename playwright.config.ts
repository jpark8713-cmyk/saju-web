// 화면 흐름 테스트(개발 서버). 목 결제 어댑터·가짜 LLM을 켜서 비용 없이 전체 흐름을 돈다.
// 운영 빌드 확인(목 결제가 없는지)은 playwright.prod.config.ts에서 따로 돈다.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// 실행마다 새 SQLite 파일을 쓴다(운영과 같은 저장소 구현으로 흐름을 돈다, D-030)
const DB = join(tmpdir(), `saju-e2e-dev-${Date.now()}.db`);

// 리뷰어를 동시에 돌릴 때는 PW_PORT로 포트를, NEXT_DIST_DIR로 빌드 폴더를 달리 준다(D-035)
const PORT = Number(process.env.PW_PORT || 3100);

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: /prod\.spec\.ts$/,
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 800 } } },
    { name: 'mobile-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL: `file:${DB}`, PAYMENT_PROVIDER: 'mock', PAYMENT_METHODS_ENABLED: 'kakaopay,tosspay', ENABLE_FAKE_LLM: 'true' },
  },
});
