// 저장한 PDF (사업자 결정 2026-10-21: 서버 데이터 폴더, D-033). DB 폴더 아래 pdf/<주문번호>.pdf에 둔다.
// 파일은 소유자만 읽고 쓴다(600). 쓰기는 임시 파일에 쓴 뒤 이름을 바꿔, 도중에 실패해도 반쯤 쓴 PDF가 남지 않게 한다.
// DB가 메모리(개발·테스트)면 임시 폴더를 쓴다.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Env } from '../config/flags';
import { ORDER_ID_RE } from '../orders/ids';
import { sqlitePathOf } from '../store';

/** write가 만드는 임시 파일 이름 */
const PART_RE = /^(.+)\.pdf\.[0-9a-f]{12}\.part$/;

export class PdfStore {
  constructor(readonly dir: string) {}

  private pathOf(orderId: string): string {
    if (!ORDER_ID_RE.test(orderId)) throw new Error('주문번호 형식이 아닙니다');
    return join(this.dir, `${orderId}.pdf`);
  }

  has(orderId: string): boolean {
    return existsSync(this.pathOf(orderId));
  }

  read(orderId: string): Buffer | null {
    const p = this.pathOf(orderId);
    return existsSync(p) ? readFileSync(p) : null;
  }

  /** 저장하고 SHA-256을 돌려준다 */
  write(orderId: string, pdf: Buffer): string {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const target = this.pathOf(orderId);
    const tmp = `${target}.${randomBytes(6).toString('hex')}.part`;
    try {
      writeFileSync(tmp, pdf, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, target);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    return createHash('sha256').update(pdf).digest('hex');
  }

  /** 저장된 PDF의 주문번호 목록(반쯤 쓴 임시 파일은 빼고) */
  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((n) => n.endsWith('.pdf'))
      .map((n) => n.slice(0, -'.pdf'.length))
      .filter((id) => ORDER_ID_RE.test(id));
  }

  /** 쓰다 멈춘 임시 파일(<주문번호>.pdf.<hex>.part) 중 기준 시각보다 오래된 것을 지운다. 지운 개수를 돌려준다(D-036) */
  deleteStaleParts(before: Date): number {
    if (!existsSync(this.dir)) return 0;
    let removed = 0;
    for (const name of readdirSync(this.dir)) {
      const m = PART_RE.exec(name);
      if (!m || !ORDER_ID_RE.test(m[1]!)) continue;
      const p = join(this.dir, name);
      try {
        if (statSync(p).mtimeMs >= before.getTime()) continue;
        rmSync(p, { force: true });
        removed += 1;
      } catch {
        // 그 사이 이름이 바뀌었거나 지워졌으면 넘어간다
      }
    }
    return removed;
  }

  delete(orderId: string): boolean {
    const p = this.pathOf(orderId);
    if (!existsSync(p)) return false;
    rmSync(p, { force: true });
    return true;
  }
}

/** DATABASE_URL(SQLite)의 폴더 아래 pdf/. 없으면 임시 폴더(개발·테스트) */
export function pdfDirOf(env: Env = process.env): string {
  const db = sqlitePathOf(env.DATABASE_URL);
  return db ? join(dirname(db), 'pdf') : join(tmpdir(), `saju-pdf-${process.pid}`);
}

const KEY = Symbol.for('saju.pdfStore');
type WithPdf = typeof globalThis & { [KEY]?: PdfStore };

export function getPdfStore(): PdfStore {
  const g = globalThis as WithPdf;
  g[KEY] ??= new PdfStore(pdfDirOf());
  return g[KEY];
}
