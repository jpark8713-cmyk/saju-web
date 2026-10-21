// 보관 기간이 지난 주문의 PDF·리포트·이메일 주소 정리 (D-033). 매시간 백업 타이머가 백업보다 먼저 컨테이너 안에서 부른다.
// 실행: npm run db:purge   (DB 위치는 DATABASE_URL). 지운 건수만 출력한다(주문번호·이메일은 출력하지 않는다).
import { getPdfStore } from '../src/delivery/pdfStore';
import { purgeExpired } from '../src/delivery/purge';
import { getStore } from '../src/store';

try {
  const r = await purgeExpired(getStore(), getPdfStore());
  console.log(JSON.stringify(r));
} catch (e) {
  // 실패 이유 종류만 남긴다(개인정보 없이)
  console.error(`[정리] 만료 데이터 정리에 실패했어요: ${e instanceof Error ? e.name : 'Error'}`);
  process.exit(1);
}
