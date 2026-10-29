// GET /api/health: 상태 확인. 실행 모드(production·rehearsal·development)를 알려 준다(D-058). 설정 값·비밀은 내보내지 않는다.
import { runMode } from '../../../config/flags';
import { json } from '../../../web/http';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return json({ status: 'ok', mode: runMode() });
}
