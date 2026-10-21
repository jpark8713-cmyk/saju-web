// GET /api/dev/outbox: 콘솔 메일 어댑터의 개발용 보관함(개발·테스트 전용, D-033). 운영에서는 항상 404다.
// 화면 흐름 테스트가 메일 속 다운로드 링크를 읽는 데 쓴다.
import { isDevRuntime } from '../../../../config/flags';
import { sharedConsoleEmail } from '../../../../delivery/email';
import { json } from '../../../../web/http';

export async function GET(): Promise<Response> {
  if (!isDevRuntime()) return json({ error: 'not_found' }, 404);
  return json({ messages: sharedConsoleEmail().outbox });
}
