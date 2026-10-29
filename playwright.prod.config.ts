// 운영 빌드 확인: next build + next start(NODE_ENV=production).
// 지금 판매 주제가 검수 전(reviewed=false)이라 순수 운영 모드는 시작을 거부한다(D-058). 그래서 이 서버는 예행 모드(목 결제 없음)로 띄우고,
// 개발용 값은 빈 값으로 못 박는다(next start가 읽는 .env 파일 값이 끼어들지 않게).
// 시작 거부 조건과 목 결제를 켠 예행 모드는 prod.spec.ts가 같은 빌드로 서버를 따로 띄워(PW_PORT+1) 확인한다.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// 실행마다 새 SQLite 파일을 쓴다(운영과 같은 저장소 구현으로 흐름을 돈다, D-030)
const DB = join(tmpdir(), `saju-e2e-prod-${Date.now()}.db`);

// 리뷰어를 동시에 돌릴 때는 PW_PORT로 포트를, NEXT_DIST_DIR로 빌드 폴더를 달리 준다(D-035)
const PORT = Number(process.env.PW_PORT || 3200);

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
    env: { DATABASE_URL: `file:${DB}`, APP_ORIGIN: `http://localhost:${PORT}`, REFUND_ID_SECRET: 'e2e-only-secret-0123456789-0123456789', TRUST_PROXY: 'true', REHEARSAL_MODE: '1', PAYMENT_PROVIDER: '', ENABLE_FAKE_LLM: '', PAYMENT_CLIENT_KEY: '', PAYMENT_SECRET_KEY: '' },
  },
});
