// 로컬 리허설: 예행 모드(REHEARSAL_MODE=1 + PAYMENT_PROVIDER=mock)로 뜬 컨테이너에 주문 → 목 결제 → (선택) 생성 → PDF를 HTTP로 돌린다.
// 사용: node scripts/rehearsal/flow.mjs <기준 주소> <결과 폴더> [--with-ai]
//   --with-ai가 없으면 결제 확인까지만 한다(비용 없음). 있으면 실제 Claude API를 1번 불러 리포트와 PDF를 만든다(건당 약 $0.25).
// 출생 정보는 가상 입력이다. 출력에는 주문번호·상태·크기만 쓰고 토큰은 쓰지 않는다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, outDir, flag] = process.argv.slice(2);
if (!base || !outDir) {
  console.error('사용법: node scripts/rehearsal/flow.mjs http://localhost:3080 <결과 폴더> [--with-ai]');
  process.exit(2);
}
const withAi = flag === '--with-ai';
mkdirSync(outDir, { recursive: true });

const BIRTH = {
  name: '리허설', calendar: 'solar', isLeapMonth: false, year: 1990, month: 5, day: 15,
  timeUnknown: false, hour: 14, minute: 30, gender: 'female', regionId: 'seoul:종로구', consent: true,
};

async function call(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers['x-order-token'] = token;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  return fetch(new URL(path, base), { method, headers, body: payload, redirect: 'manual' });
}

async function json(res, step) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${step}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const step = (name, detail = '') => console.log(`[흐름] ${name}${detail ? `: ${detail}` : ''}`);

// 1) 상태 확인
const health = await json(await call('/api/health'), '상태 확인');
step('상태 확인', JSON.stringify(health));
if (health.mode !== 'rehearsal') throw new Error('예행 모드가 아니에요(REHEARSAL_MODE=1로 띄웠는지 확인)');

// 2) 주문 → 결제 준비 → 목 결제창 승인 → 결제 확인
const order = await json(await call('/api/orders', { method: 'POST', body: { birth: BIRTH, topicIds: ['wealth'], deliveryMethods: ['pdf'], email: null, paymentMethod: 'kakaopay' } }), '주문');
step('주문', `${order.orderId}, ${order.amount}원`);
const prep = await json(await call('/api/payments/prepare', { method: 'POST', token: order.accessToken, body: { orderId: order.orderId, paymentMethod: 'kakaopay' } }), '결제 준비');
const paymentKey = new URL(prep.redirectUrl, base).searchParams.get('paymentKey');
const auth = await call('/api/dev/mock-pg', { method: 'POST', form: { paymentKey, outcome: 'success', amount: String(order.amount) } });
if (auth.status !== 303) throw new Error(`목 결제창 승인: HTTP ${auth.status}`);
const back = new URL(auth.headers.get('location'), base);
step('목 결제창 승인', back.pathname);
const confirmed = await json(await call('/api/payments/confirm', { method: 'POST', token: order.accessToken, body: { orderId: order.orderId, paymentKey: back.searchParams.get('paymentKey'), amount: Number(back.searchParams.get('amount')) } }), '결제 확인');
step('결제 확인', JSON.stringify({ status: confirmed.status ?? confirmed.order?.status ?? 'ok' }));

if (!withAi) {
  step('생성 건너뜀', '--with-ai 없이 실행해 실제 Claude API를 부르지 않았어요');
  process.exit(0);
}

// 3) 생성(실제 Claude API 1번) → 완료까지 기다림
const started = Date.now();
await json(await call('/api/reports/generate', { method: 'POST', token: order.accessToken, body: { orderId: order.orderId } }), '생성 시작');
let status;
for (;;) {
  status = await json(await call(`/api/orders/${order.orderId}/status`, { token: order.accessToken }), '상태 조회');
  if (status.status === 'done' || status.status === 'failed') break;
  if (Date.now() - started > 240_000) throw new Error('생성이 4분 안에 끝나지 않았어요');
  await new Promise((r) => setTimeout(r, 3000));
}
step('생성', `${status.status}, ${Math.round((Date.now() - started) / 1000)}초`);
if (status.status !== 'done') throw new Error('생성 실패(서버 로그: docker logs saju-rehearsal)');

// 4) PDF(컨테이너 안 Chromium) 받기
const t0 = Date.now();
const pdfRes = await call(`/api/reports/${order.orderId}/pdf`, { token: order.accessToken });
if (!pdfRes.ok) throw new Error(`PDF: HTTP ${pdfRes.status}`);
const pdf = Buffer.from(await pdfRes.arrayBuffer());
const file = join(outDir, `rehearsal-${order.orderId}.pdf`);
writeFileSync(file, pdf);
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
step('PDF', `${pdf.length}바이트, ${pages}쪽, ${Math.round((Date.now() - t0) / 1000)}초, ${pdf.subarray(0, 4).toString() === '%PDF' ? '형식 정상' : '형식 이상'} → ${file}`);
