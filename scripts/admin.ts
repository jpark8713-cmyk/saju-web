// 운영자 관리 스크립트 (D-028): 환불 조회·처리, 멈춘 생성 주문 복구. 서버에서 직접 실행한다.
// 실행: npm run admin -- refunds list   (운영: docker exec saju-web npm run admin -- refunds list)
// 웹 서버와 같은 SQLite 파일(DATABASE_URL)을 연다. DATABASE_URL이 없으면 메모리 저장소라 웹 서버의 데이터가 보이지 않는다.
import { runAdmin } from '../src/admin/cli';
import { getPaymentProvider } from '../src/payments';
import { getStore } from '../src/store';
import { MemoryStore } from '../src/store/memory';

const store = getStore();
if (store instanceof MemoryStore) {
  console.error('주의: DATABASE_URL이 없어 메모리 저장소예요. 웹 서버의 주문·환불 데이터는 보이지 않아요.');
}
const code = await runAdmin(process.argv.slice(2), { store, provider: getPaymentProvider(), out: (line) => console.log(line) });
process.exit(code);
