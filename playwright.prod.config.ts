// 운영 빌드 확인: next build + next start(NODE_ENV=production). 가짜 결제 플래그를 켜 두어도 꺼져 있어야 한다(D-025).
import { defineConfig, devices } from '@playwright/test';

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
    env: { ENABLE_FAKE_PAYMENT: 'true', ENABLE_FAKE_LLM: 'true' },
  },
});
