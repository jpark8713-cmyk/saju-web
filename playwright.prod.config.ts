// 운영 빌드 확인: next build + next start(NODE_ENV=production). 목 결제(PAYMENT_PROVIDER=mock)를 켜 두어도 꺼져 있어야 한다(D-025).
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// 실행마다 새 SQLite 파일을 쓴다(운영과 같은 저장소 구현으로 흐름을 돈다, D-030)
const DB = join(tmpdir(), `saju-e2e-prod-${Date.now()}.db`);

const PORT = 3200;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /prod\.spec\.ts$/,
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}`, viewport: { width: 390, height: 844 } },
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 600_000,
    // 일부러 켜 둔다: 운영 환경에서는 이 값과 관계없이 꺼져야 한다
    env: { DATABASE_URL: `file:${DB}`, APP_ORIGIN: `http://localhost:${PORT}`, REFUND_ID_SECRET: 'e2e-only-secret-0123456789-0123456789', TRUST_PROXY: 'true', PAYMENT_PROVIDER: 'mock', ENABLE_FAKE_LLM: 'true' },
  },
});
