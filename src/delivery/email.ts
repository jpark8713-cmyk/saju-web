// 메일 발송 어댑터 (SPEC Phase 5). 실제 메일 서비스 연동은 서비스명·도메인이 정해질 때까지 보류한다(D-033).
// - console: 개발·테스트 전용. 메일은 보내지 않고 메모리 보관함(outbox)에 넣는다. 로그에는 받는 사람·링크를 남기지 않는다.
// - 운영에서는 실제 어댑터가 생기기 전까지 발송 어댑터가 없다(발송은 실패로 기록되고, 화면에서 PDF를 받을 수 있다).
import { isDevRuntime, type Env } from '../config/flags';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** 어느 주문의 메일인지 (로그·보관함용) */
  orderId: string;
}

export type SendResult = { ok: true } | { ok: false; code: string };

export interface EmailProvider {
  readonly id: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly id = 'console';
  /** 개발용 보관함(최근 50통). 화면 흐름 테스트가 /api/dev/outbox로 읽는다 */
  readonly outbox: (EmailMessage & { at: string })[] = [];
  /** 테스트에서 실패를 재현한다: 남은 횟수만큼 실패 */
  failNext = 0;

  async send(message: EmailMessage): Promise<SendResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return { ok: false, code: 'CONSOLE_FORCED_FAILURE' };
    }
    this.outbox.push({ ...message, at: new Date().toISOString() });
    if (this.outbox.length > 50) this.outbox.shift();
    // 받는 사람 주소와 링크는 기록하지 않는다(SPEC: 로그에 이메일 주소가 남지 않음)
    console.info(`[메일:콘솔] 주문 ${message.orderId}의 다운로드 링크 메일 1통을 개발용 보관함에 넣었어요`);
    return { ok: true };
  }
}

const KEY = Symbol.for('saju.consoleEmail');
type WithEmail = typeof globalThis & { [KEY]?: ConsoleEmailProvider };

export function sharedConsoleEmail(): ConsoleEmailProvider {
  const g = globalThis as WithEmail;
  g[KEY] ??= new ConsoleEmailProvider();
  return g[KEY];
}

export function getEmailProvider(env: Env = process.env): EmailProvider | null {
  const id = env.EMAIL_PROVIDER?.trim() || 'console';
  if (id === 'console') return isDevRuntime(env) ? sharedConsoleEmail() : null;
  return null;
}
