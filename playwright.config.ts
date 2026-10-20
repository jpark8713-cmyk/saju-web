// 화면 흐름 테스트(개발 서버). 가짜 결제·가짜 LLM을 켜서 비용 없이 전체 흐름을 돈다.
// 운영 빌드 확인(가짜 결제가 없는지)은 playwright.prod.config.ts에서 따로 돈다.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

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
    env: { ENABLE_FAKE_PAYMENT: 'true', ENABLE_FAKE_LLM: 'true' },
  },
});
