// Phase 3·4 완료 기준을 화면에서 확인한다(개발 서버, 목 결제 어댑터·가짜 LLM).
// 개발 서버는 결제 수단 설정에서 토스페이를 더 켜 둔다(설정으로 수단이 열리는지 확인). 기본 설정(카카오페이만)은 prod.spec.ts가 확인한다.
import { expect, test } from '@playwright/test';
import { expectFooter, expectNoHorizontalScroll, fillBirth, pay, toCheckout, toPreview } from './helpers';

test('시작 → 입력 → 계산 → 미리보기 → 결제 → 생성 → 리포트, 화면마다 푸터와 가로 스크롤 없음', async ({ page }) => {
  await page.goto('/');
  await expectFooter(page);
  await expectNoHorizontalScroll(page);
  await fillBirth(page, { name: '홍길동' });
  await expectFooter(page);
  await expectNoHorizontalScroll(page);
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('preview-document')).toBeVisible();
  await expect(page.getByRole('heading', { name: '홍길동님의 사주' })).toBeVisible();
  await expectFooter(page);
  await expectNoHorizontalScroll(page);

  // 잠긴 섹션은 제목과 "결제 후 공개"만
  for (const title of ['타고난 성향', '주제별 풀이', '대운 흐름', '올해·내년 흐름']) {
    const sec = page.locator('[data-locked="true"]').filter({ has: page.getByRole('heading', { name: title }) });
    await expect(sec).toContainText('결제 후 공개');
  }

  await toCheckout(page, ['wealth']);
  await expectFooter(page);
  await expectNoHorizontalScroll(page);
  await expect(page.getByTestId('pay-button')).toBeDisabled();
  await expect(page.getByTestId('method-naverpay')).toContainText('준비 중');
  await expect(page.getByTestId('method-naverpay').locator('input')).toBeDisabled();
  await pay(page, 'success');

  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  await expectFooter(page);
  await expectNoHorizontalScroll(page);
  // 같은 템플릿: 잠겼던 섹션이 같은 제목으로 열린다
  const sections = await page.locator('[data-testid="report-document"] [data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  expect(sections).toEqual(['summary', 'traits', 'topics', 'daewoon', 'yearly', 'months', 'years', 'disclaimer']);
  await expect(page.getByTestId('basis-counting')).toContainText('지장간은 세지 않습니다');
  // D-056 계산 기준: 지역 모름(동경 127°) 14:30 → 보정 차이와 예시가 맞물리고, 해당 없는 표준시·기둥 차이 줄은 없다
  await expect(page.getByTestId('basis-time')).toContainText('표준시보다 32분 늦은 그 지역 시각을 써요. 입력 14:30 → 13:58:00');
  await expect(page.getByTestId('basis-jasi')).toContainText('시주는 다음 날 기준 자시');
  await expect(page.getByTestId('basis-calendar')).toContainText('경도 보정 없이 시계 시각');
  await expect(page.getByTestId('basis-timezone')).toHaveCount(0);
  await expect(page.getByTestId('basis-clock')).toHaveCount(0);
  // D-052: 월별 흐름 12칸(계절 묶음 머리 4개), 10년 흐름 10칸, 올해·내년 칸 아래 링크 줄
  await expect(page.locator('[data-section="months"] [data-period-group]')).toHaveCount(12);
  await expect(page.locator('[data-section="months"]').getByTestId('period-cluster')).toHaveCount(4);
  await expect(page.locator('[data-section="years"] [data-period-group]')).toHaveCount(10);
  await expect(page.locator('[data-section="years"]').getByTestId('period-flow').first()).toContainText('큰 흐름:');
  // D-052 3단계: 10년 흐름의 올해·내년은 사실 줄 + 올해·내년 칸 링크, 월별 계절 머리는 날짜 범위와 절기
  // C안: 어른 월별·10년은 달·해마다 사실 줄(10년의 올해·내년만 링크)
  await expect(page.locator('[data-section="years"]').getByTestId('period-fact')).toHaveCount(10);
  await expect(page.locator('[data-section="months"]').getByTestId('period-fact')).toHaveCount(12);
  await expect(page.locator('[data-section="years"] .period-fact a[href="#section-yearly"]')).toHaveCount(2);
  await expect(page.locator('[data-section="months"]').getByTestId('period-cluster').first()).toHaveText(/^\d{4}년 \d{1,2}\/\d{1,2} ~ \d{4}년 \d{1,2}\/\d{1,2} \(.+\)$/);
  await expect(page.locator('[data-section="yearly"]').getByTestId('section-note')).toContainText('월별 흐름');
  await page.locator('[data-section="yearly"] a[href="#section-years"]').click();
  await expect(page.locator('#section-years')).toBeInViewport();
  await expect(page.locator('[data-section="topics"]')).toContainText('재물');
  await expect(page.locator('[data-section="topics"]')).not.toContainText('연애·결혼');
  await expect(page.getByTestId('pdf-download')).toBeVisible();
  await expect(page.getByTestId('email-status')).toHaveCount(0);
  // 리포트를 받으면 탭에 남은 입력값(이름·생년월일시)을 지운다
  expect(await page.evaluate(() => [sessionStorage.getItem('saju.birth'), sessionStorage.getItem('saju.preview')])).toEqual([null, null]);
});

test('입력 화면: 필수값·동의가 없으면 버튼이 꺼지고 한국어 문구, 음력에서만 윤달, 시간 모름이면 시·분 비활성', async ({ page }) => {
  await page.goto('/input');
  await expect(page.getByTestId('input-submit')).toBeDisabled();
  // 빠진 항목을 버튼 아래에 문장으로 알려 준다
  const missing = page.getByTestId('missing-fields');
  for (const text of ['생년월일을 입력해 주세요.', '태어난 시간을 입력하거나 "모름"을 선택해 주세요.', '성별을 선택해 주세요.', '개인정보 수집·이용 동의가 필요해요.']) {
    await expect(missing).toContainText(text);
  }
  // 시만 고르고 분을 비우면 분까지 고르라고 알려 준다
  await page.getByLabel('시', { exact: true }).selectOption('14');
  await expect(missing).toContainText('태어난 시간의 분까지 선택해 주세요.');
  await page.getByLabel('분', { exact: true }).selectOption('30');
  await expect(missing).not.toContainText('태어난 시간');
  await page.getByLabel('시', { exact: true }).selectOption('');
  await page.getByLabel('분', { exact: true }).selectOption('');
  await expect(page.getByTestId('leap-month')).toHaveCount(0);
  await page.getByLabel('음력').check();
  await expect(page.getByTestId('leap-month')).toBeVisible();
  await page.getByLabel('태어난 해').fill('1800');
  await page.getByLabel('태어난 해').blur();
  await expect(page.locator('#date-error')).toHaveText('1900~2050년 사이로 입력해 주세요.');
  await page.getByTestId('time-unknown').check();
  await expect(page.getByLabel('시', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('분', { exact: true })).toBeDisabled();
  await page.getByTestId('consent').check();
  await page.getByTestId('consent').uncheck();
  await expect(page.locator('#consent-error')).toHaveText('개인정보 수집·이용 동의가 필요해요.');
});

test('태어난 지역: 시도를 고른 뒤 시군구를 고르고, 같은 이름(광주)도 시도별로 구분된다', async ({ page }) => {
  await fillBirth(page);
  const province = page.getByTestId('region-province');
  const district = page.getByTestId('region-district');
  await expect(province.locator('option').first()).toHaveText('모름 · 해외 (서울 기준 동경 127°)');
  await expect(district).toBeDisabled();
  await province.selectOption({ label: '경기' });
  await expect(district).toBeEnabled();
  await expect(district).toHaveValue('gyeonggi');
  await district.selectOption({ label: '광주시' });
  await expect(district).toHaveValue('gyeonggi:광주시');
  // 시도를 바꾸면 시군구는 "시군구 모름"으로 돌아간다
  await province.selectOption({ label: '광주' });
  await expect(district).toHaveValue('gwangju');
  await expect(district.locator('option')).toHaveText(['시군구 모름', '동구', '서구', '남구', '북구', '광산구']);
  await district.selectOption({ label: '북구' });
  await expect(page.getByTestId('input-submit')).toBeEnabled();
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('preview-document')).toBeVisible();
  // 미리보기 근거에 실제 쓴 경도가 나온다
  await expect(page.getByTestId('preview-document')).toContainText('동경 126.91°');
});

test('경도 보정으로 시주가 달라지면 계산 기준에 한 줄, 서머타임 출생은 표준시 줄(D-056)', async ({ page }) => {
  // 서울 종로구(126.98°) 1999-12-31 23:30 → 보정 22:57(해시). 시계 시각 그대로면 임자(壬子)시
  await fillBirth(page, { year: '1999', month: '12', day: '31' });
  await page.getByLabel('시', { exact: true }).selectOption('23');
  await page.getByLabel('분', { exact: true }).selectOption('30');
  await page.getByTestId('region-province').selectOption({ label: '서울' });
  await page.getByTestId('region-district').selectOption({ label: '종로구' });
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('preview-document')).toBeVisible();
  await expect(page.getByTestId('basis-time')).toContainText('표준시보다 32분 5초 늦은 그 지역 시각을 써요. 입력 23:30 → 22:57:55(초는 버리고 22:57 기준으로 계산)');
  await expect(page.getByTestId('basis-clock')).toHaveText('참고: 이 리포트는 경도 보정 시각으로 기둥을 정했어요. 보정 없이 시계 시각 그대로(23:30) 보는 만세력에서는 시주가 임자(壬子)로 다르게 나올 수 있어요');
  // 눈에 띄는 안내 상자가 아니라 계산 기준 섹션 안의 한 줄
  await expect(page.locator('[data-section="disclaimer"]').getByTestId('basis-clock')).toHaveCount(1);
  await expect(page.getByTestId('chart-notices')).toHaveCount(0);
  await expect(page.getByTestId('basis-timezone')).toHaveCount(0);

  // 1987 서머타임 출생: 표준시 줄이 나온다
  await fillBirth(page, { year: '1987', month: '7', day: '15' });
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('preview-document')).toBeVisible();
  await expect(page.getByTestId('basis-timezone')).toHaveText('표준시: 서머타임 기간이라 1시간을 빼서 계산했어요');
});

test('음력 윤달 + 시간 모름으로 미리보기까지, 없는 윤달은 서버 검증 문구로 돌아온다', async ({ page }) => {
  // 2020년 음력 윤4월은 있다
  await toPreview(page, { calendar: 'lunar', leap: true, year: '2020', month: '4', day: '10', timeUnknown: true });
  await expect(page.getByTestId('saju-chart')).toContainText('모름');
  // 개수 기준 안내(지장간 제외)는 글자 수 없이 나와 시간 모름(6글자)에서도 그대로 읽힌다
  await expect(page.getByTestId('basis-counting')).toHaveText('오행·십성 개수는 겉으로 드러난 천간·지지 글자만 셉니다(지장간은 세지 않습니다)');
  // 음력 12월(양력으로는 다음 해 1월)도 받아들인다(D-026)
  await toPreview(page, { calendar: 'lunar', year: '1990', month: '12', day: '10' });
  await expect(page.getByTestId('preview-document')).toContainText('음력 1990년 12월 10일');
  // 2023년 윤5월은 없다 → 서버(엔진) 검증
  await fillBirth(page, { calendar: 'lunar', leap: true, year: '2023', month: '5', day: '1' });
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('screen-input')).toBeVisible();
  await expect(page.getByText('존재하지 않는 음력 날짜입니다. 윤달 여부를 확인해 주세요.')).toBeVisible();
});

test('미리보기 응답과 HTML 소스에 잠긴 본문이 없고, 총평 근거 버튼이 동작한다', async ({ page }) => {
  const chartResponse = page.waitForResponse('**/api/chart');
  await toPreview(page);
  const body = await (await chartResponse).json();
  expect(Object.keys(body.preview.locked[0]).sort()).toEqual(['id', 'title']);
  expect(JSON.stringify(body)).not.toMatch(/"(traits|topics|daewoonNotes|yearly)"\s*:/);
  expect(body.preview.chart.daewoon).toEqual([]);
  const html = await page.content();
  expect(html).not.toContain('개발용 가짜 문장');
  expect(await page.locator('[data-locked="true"] li').count()).toBe(0);

  // 근거 버튼을 누르면 문장 바로 아래에 사실 카드와 미니 차트(해당 글자 강조)가 펼쳐진다(D-042 시안 A)
  const btn = page.locator('[data-section="summary"] .ref-button').first();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const card = page.getByTestId('evidence-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('나를 나타내는 글자는');
  await expect(card.locator('.mini-glyph.is-on')).toHaveCount(1);
  expect(await page.locator('.is-highlighted').count()).toBeGreaterThan(0);
  await btn.click();
  await expect(card).toHaveCount(0);
});

test('받는 방법을 모두 해제하면 "다음"이 꺼지고, 이메일은 고를 때만 입력란이 나온다', async ({ page }) => {
  await toPreview(page);
  await page.getByTestId('delivery-pdf').uncheck();
  await expect(page.getByTestId('preview-next')).toBeDisabled();
  await expect(page.getByTestId('email')).toHaveCount(0);
  await page.getByTestId('delivery-email').check();
  await page.getByTestId('email').fill('wrong');
  await expect(page.getByTestId('preview-next')).toBeDisabled();
  await page.getByTestId('email').fill('a@example.com');
  await expect(page.getByTestId('preview-next')).toBeEnabled();
  await page.getByTestId('topic-love').check();
  await expect(page.getByTestId('price-total')).toContainText('13,000원');
});

test('리포트 근거 버튼: 키보드로 누르면 문장 아래에 근거가 펼쳐지고, 다른 문장을 누르면 그쪽으로 옮겨 간다', async ({ page }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await pay(page);
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  const buttons = page.locator('[data-testid="report-document"] .ref-button');
  const first = buttons.first();
  // 다른 사실을 가리키는 버튼을 찾는다
  const firstRefs = await first.getAttribute('data-refs');
  const other = page.locator(`[data-testid="report-document"] .ref-button:not([data-refs="${firstRefs}"])`).first();

  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  const before = await page.locator('.is-highlighted').evaluateAll((els) => els.map((e) => e.getAttribute('data-ref')));
  expect(before.length).toBeGreaterThan(0);

  await other.focus();
  await page.keyboard.press('Space');
  await expect(other).toHaveAttribute('aria-expanded', 'true');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('evidence-card')).toHaveCount(1);
  const after = await page.locator('.is-highlighted').evaluateAll((els) => els.map((e) => e.getAttribute('data-ref')));
  expect(after).not.toEqual(before);
  // 카드는 그 문장 안에 있다(문장을 읽던 자리에서 바로 본다)
  const cardId = await other.getAttribute('aria-controls');
  await expect(page.locator(`li:has(> [aria-controls="${cardId}"]) > [data-testid="evidence-card"]`)).toBeVisible();
  // "자세히"를 누르면 용어 풀이·전문 표기가 나온다
  const card = page.getByTestId('evidence-card');
  await card.getByRole('button', { name: '자세히(용어·전문 표기)' }).first().click();
  await expect(card.getByTestId('evidence-detail').first()).toBeVisible();
  // 강조는 색이 아니라 테두리(outline)로도 구분된다
  const outline = await page.locator('.is-highlighted').first().evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(outline).toBe('solid');
  await expectNoHorizontalScroll(page);
});

test('풀이 근거 목록: 기본은 접혀 있고, 펼치면 쉬운 사실 + 그 사실을 쓴 문장, 전문 표기는 버튼으로만', async ({ page }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await pay(page);
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  const list = page.getByTestId('evidence-list');
  await expect(list.locator('li')).toHaveCount(0);
  const toggle = page.getByTestId('evidence-list-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(list.locator('[data-evidence-group]').first()).toHaveAttribute('data-evidence-group', 'natal');
  const facts = await list.getByTestId('fact-text').allTextContents();
  expect(facts[0]).toMatch(/^나를 나타내는 글자는 태어난 날의 윗글자/u);
  expect(facts.filter((t) => /[은이을와]\((는|가|를|과)\)/u.test(t))).toEqual([]);
  // 기본 문구에는 전문 용어가 없다
  expect(facts.filter((t) => /일간|원국|천간|지지|[년월일시]주|오행|대운|세운|비견|겁재|식신|상관|편재|정재|편관|정관|편인|정인/u.test(t))).toEqual([]);
  await expect(toggle).toContainText(`사실 ${facts.length}개`);
  // ↳ 줄을 누르면 그 문장으로 이동한다
  const use = list.getByTestId('used-by').first();
  const href = await use.getAttribute('href');
  expect(href).toMatch(/^#sentence-s\d+$/);
  await use.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator(href!)).toBeInViewport();
  // 전문 표기는 버튼을 눌러야 나온다
  await expect(list.getByTestId('evidence-detail')).toHaveCount(0);
  await page.getByTestId('evidence-detail-toggle').click();
  await expect(list.getByTestId('evidence-detail').first()).toContainText('일간');
  await expectNoHorizontalScroll(page);
});

test('PDF: 각주 번호와 사실 목록이 화면과 일치하고 Noto 글꼴이 들어간다', async ({ page }) => {
  await toPreview(page);
  await toCheckout(page, ['career']);
  await pay(page);
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('evidence-list-toggle').click();
  const screenFacts = await page.locator('[data-testid="evidence-list"]').getByTestId('fact-text').allTextContents();

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('pdf-download').click();
  const file = await (await download).path();
  const { copyFile, readFile } = await import('node:fs/promises');
  // 사람이 PDF를 직접 열어 확인할 때만 저장한다
  if (process.env.SAVE_PDF_TO) await copyFile(file!, process.env.SAVE_PDF_TO);
  const pdf = (await readFile(file!)).toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
  expect(pdf).toMatch(/NotoSerifKR|Noto Serif KR|NotoSerif/);
  expect(pdf).toMatch(/NotoSansKR|Noto Sans KR|NotoSans/);

  // 인쇄용 페이지를 같은 토큰으로 열어 번호·목록을 화면과 비교한다
  const order = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saju.order')!));
  const ctx = await page.context().browser()!.newContext({ extraHTTPHeaders: { 'x-order-token': order.accessToken } });
  const print = await ctx.newPage();
  await print.goto(`/report/${order.orderId}/print`);
  const printList = print.locator('[data-testid="evidence-list"]');
  expect(await printList.getByTestId('fact-text').allTextContents()).toEqual(screenFacts);
  const items = await printList.locator('.evidence-list > li').allTextContents();
  expect(items[0]).toMatch(/^① 나를 나타내는 글자는/u);
  // 각주 번호는 목록에 있는 번호만 가리킨다
  const listed = new Set(items.map((t) => t.split(' ')[0]));
  const refs = await print.locator('.ref-num').allTextContents();
  expect(refs.length).toBeGreaterThan(0);
  expect(refs.every((r) => listed.has(r))).toBe(true);
  // PDF는 누를 수 없으니 접힘·전문 표기·↳ 줄·근거 버튼이 없다
  expect(await print.getByTestId('evidence-list-toggle').count()).toBe(0);
  expect(await print.getByTestId('evidence-detail-toggle').count()).toBe(0);
  expect(await print.getByTestId('used-by').count()).toBe(0);
  expect(await print.locator('.ref-button').count()).toBe(0);
  const sections = await print.locator('[data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  expect(sections).toEqual(['summary', 'traits', 'topics', 'daewoon', 'yearly', 'months', 'years', 'disclaimer']);
  // D-052: PDF에서 월별·10년 흐름은 새 쪽에서 시작하고, 칸은 쪽 사이에서 나뉘지 않는다(3단계: 7번째 달 강제 넘김은 뺐다. 실제 쪽수는 PDF로 확인: 월별 2쪽·10년 1쪽)
  await print.emulateMedia({ media: 'print' });
  const breaks = await print.evaluate(() => ['[data-section="months"]', '[data-section="years"]'].map((q) => getComputedStyle(document.querySelector(q)!).breakBefore));
  expect(breaks).toEqual(['page', 'page']);
  const inside = await print.evaluate(() => getComputedStyle(document.querySelector('[data-section="months"] [data-period-group="6"]')!).breakInside);
  expect(inside).toBe('avoid');
  // PDF에는 링크 대신 안내 문구만
  await expect(print.locator('[data-section="yearly"] .period-link')).toHaveCount(0);
  await expect(print.locator('[data-section="years"] .period-link')).toHaveCount(0);
  await expect(print.locator('[data-section="years"]').getByTestId('period-fact').first()).toContainText('올해·내년 흐름 칸 참고');
  await ctx.close();
});

test('인쇄용 페이지는 토큰 없이 열리지 않는다', async ({ page }) => {
  const res = await page.goto('/report/SJ20261020-ABCDEFGH/print');
  expect(res!.status()).toBe(404);
});

test('오류 A: 결제 실패 → 사유 표시, 다시 결제·미리보기 복귀(입력 유지)', async ({ page }) => {
  await toPreview(page, { name: '김철수' });
  await page.getByTestId('topic-love').check();
  await page.getByTestId('preview-next').click();
  await pay(page, 'fail');
  await expect(page.getByTestId('screen-pay-failed')).toBeVisible();
  await expect(page.getByTestId('pay-failure-reason')).toContainText('결제 창에서 결제를 취소했어요');
  await expectFooter(page);
  await page.getByRole('link', { name: '미리보기로 돌아가기' }).click();
  await expect(page.getByRole('heading', { name: '김철수님의 사주' })).toBeVisible();
  await expect(page.getByTestId('topic-love')).toBeChecked();
});

test('목 결제창: 결제 뒤 뒤로 가기로 돌아와 다시 제출하면 JSON 대신 "이미 처리된 결제" 안내와 주문 화면 링크', async ({ page, request }) => {
  await toPreview(page);
  await toCheckout(page);
  await pay(page, 'success');
  await expect(page.getByTestId('screen-order')).toBeVisible();
  const orderUrl = new URL(page.url()).pathname;
  await page.goBack();
  // 브라우저가 예전 결제창을 그대로 보여 주면 다시 제출하고, 새로 불러오면 바로 안내가 나온다
  if (await page.getByTestId('mock-pg').isVisible()) {
    await page.getByTestId('mock-pg-fail').check();
    await page.getByTestId('mock-pg-submit').click();
  }
  const notice = page.getByTestId('mock-pg-processed');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('이미 처리된 결제예요');
  await expect(page.locator('body')).not.toContainText('not_found');
  // 서버를 다시 켠 뒤처럼 없는 결제창을 제출해도 안내 화면으로 간다
  const res = await request.post('/api/dev/mock-pg', { form: { paymentKey: 'mock_unknown', outcome: 'fail', amount: '1' }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  await page.getByRole('link', { name: '주문 화면으로 가기' }).click();
  await expect(page).toHaveURL(new RegExp(`${orderUrl}$`));
  await expect(page.getByTestId('screen-order')).toBeVisible();
});

test('오류 B → D → E: 생성 실패, 다시 시도, 환불 요청(주문번호 자동 입력) 접수', async ({ page }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await pay(page, 'success-genfail');
  await expect(page.getByTestId('screen-generation-failed')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('auto-retry-notice')).toBeVisible();
  await expectFooter(page);
  await expectNoHorizontalScroll(page);
  await page.getByTestId('retry-now').click();
  await expect(page.getByTestId('screen-generation-failed')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('go-refund').click();
  await expect(page.getByTestId('screen-refund')).toBeVisible();
  const orderId = await page.getByTestId('refund-order-id').inputValue();
  expect(orderId).toMatch(/^SJ\d{8}-/);
  // 결제한 탭이라 주문 토큰으로 본인 확인이 된다
  await expect(page.getByTestId('refund-device-verified')).toBeVisible();
  await expect(page.getByTestId('refund-order-email-field')).toHaveCount(0);
  await expect(page.getByTestId('refund-submit')).toBeDisabled();
  await page.getByTestId('refund-email').fill('bad');
  await expect(page.getByText('처리 결과를 받을 이메일 주소를 정확히 입력해 주세요.')).toBeVisible();
  await page.getByTestId('refund-email').fill('a@example.com');
  await page.getByTestId('refund-submit').click();
  await expect(page.getByTestId('screen-refund-done')).toBeVisible();
  await expect(page.getByTestId('refund-id')).toHaveText(/^RF\d{8}-/);
  await expect(page.getByTestId('screen-refund-done')).toContainText(orderId);
  await expect(page.getByTestId('refund-ack')).toContainText('확인 결과는 이메일로 알려드려요.');
  await expectFooter(page);
});

test('결제창에서 금액을 바꾸면 승인하지 않고 화면 A로 간다(생성도 시작되지 않음)', async ({ page, request }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await pay(page, 'success', { amount: 100 });
  await expect(page.getByTestId('screen-pay-failed')).toBeVisible();
  await expect(page.getByTestId('pay-failure-reason')).toContainText('결제 금액이 주문 금액과 달라');
  const order = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saju.order')!));
  const gen = await request.post('/api/reports/generate', { headers: { 'x-order-token': order.accessToken }, data: { orderId: order.orderId } });
  expect(gen.status()).toBe(409);
  // 다시 결제하면 정상 금액으로 결제된다
  await page.getByTestId('retry-payment').click();
  await pay(page, 'success');
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
});

test('승인 화면을 다시 열어 같은 승인 요청이 다시 가도 결제·생성은 한 번', async ({ page, request }) => {
  await toPreview(page);
  await toCheckout(page, []);
  const visited: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) visited.push(f.url());
  });
  await pay(page, 'success');
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  const completeUrl = visited.find((u) => u.includes('/checkout/complete?'))!;
  expect(completeUrl).toContain('paymentKey=');
  // 결제창 복귀 주소를 다시 열면 같은 결제 키로 승인 요청이 한 번 더 간다
  await page.goto(completeUrl);
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  const order = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saju.order')!));
  const status = await (await request.get(`/api/orders/${order.orderId}/status`, { headers: { 'x-order-token': order.accessToken } })).json();
  expect(status).toMatchObject({ status: 'done', runs: 1 });
  // 다른 결제 키로 온 승인 요청은 거부된다
  const other = await request.post('/api/payments/confirm', { headers: { 'x-order-token': order.accessToken }, data: { orderId: order.orderId, paymentKey: 'mock_other', amount: order.amount } });
  expect(other.status()).toBe(400);
});

test('설정에서 켠 토스페이로 고르고 결제할 수 있다', async ({ page }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await expect(page.getByTestId('method-tosspay').locator('input')).toBeEnabled();
  await pay(page, 'success', { method: 'tosspay' });
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('saju.order')!).paymentMethod)).toBe('tosspay');
});

test('다른 기기(새 브라우저)에서 환불 화면: 주문 이메일 칸과 고객센터 안내, 응답은 같은 모양', async ({ page, browser }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await pay(page, 'success');
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  const orderId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saju.order')!).orderId as string);

  const other = await browser.newPage();
  try {
    await other.goto(`/refund?orderId=${orderId}`);
    await expect(other.getByTestId('refund-order-email-field')).toBeVisible();
    await expect(other.getByTestId('refund-other-device')).toContainText('고객센터 이메일');
    await expect(other.getByTestId('refund-other-device')).toContainText('결제 내역');
    await other.getByTestId('refund-order-email').fill('nobody@example.com');
    await other.getByTestId('refund-email').fill('reply@example.com');
    await other.getByTestId('refund-submit').click();
    await expect(other.getByTestId('screen-refund-done')).toBeVisible();
    await expect(other.getByTestId('refund-id')).toHaveText(/^RF\d{8}-[A-Z2-9]{8}$/);
    await expect(other.getByTestId('refund-ack')).toContainText('확인 결과는 이메일로 알려드려요.');
    await expectNoHorizontalScroll(other);
  } finally {
    await other.close();
  }
});

test('오류 C: 만료 링크 → 링크 다시 받기, 같은 안내 문구', async ({ page }) => {
  await page.goto('/api/download/expired-token');
  await expect(page.getByTestId('screen-resend')).toBeVisible();
  await expect(page.getByTestId('link-expired')).toBeVisible();
  // 만료 기간을 분명히 적는다(설정값 30일)
  await expect(page.getByTestId('link-expired')).toContainText('30일');
  await expectFooter(page);
  await expectNoHorizontalScroll(page);
  await page.getByTestId('resend-order-id').fill('SJ20261020-ABCDEFGH');
  await page.getByTestId('resend-email').fill('a@example.com');
  await page.getByTestId('resend-submit').click();
  await expect(page.getByTestId('resend-message')).toContainText('주문번호와 이메일이 일치하면');
});

test('화면 6(생성 중)과 계산 중 화면에도 푸터, 약관 3종 페이지', async ({ page }) => {
  // 생성 중 화면: 상태 응답을 늦춰 화면 6을 붙잡는다
  await toPreview(page);
  await toCheckout(page, []);
  await page.route('**/api/orders/*/status', async (route) => {
    await new Promise((r) => setTimeout(r, 3_000));
    await route.continue();
  });
  await page.route('**/api/reports/generate', async (route) => {
    await new Promise((r) => setTimeout(r, 3_000));
    await route.continue();
  });
  await pay(page);
  await expect(page.getByTestId('screen-generating')).toBeVisible();
  await expectFooter(page);
  await expectNoHorizontalScroll(page);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await page.route('**/api/chart', async (route) => {
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });
  await fillBirth(page);
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('screen-calculating')).toBeVisible();
  await expectFooter(page);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  for (const doc of ['terms', 'refund', 'privacy']) {
    await page.goto(`/legal/${doc}`);
    await expect(page.getByTestId(`screen-legal-${doc}`)).toBeVisible();
    await expectFooter(page);
    await expectNoHorizontalScroll(page);
  }
});

test('계산이 10초를 넘으면 다시 시도 안내', async ({ page }) => {
  test.setTimeout(60_000);
  await fillBirth(page);
  await page.route('**/api/chart', async (route) => {
    await new Promise((r) => setTimeout(r, 12_000));
    await route.continue().catch(() => undefined);
  });
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('calc-retry')).toBeVisible({ timeout: 15_000 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('이메일로 받기: 결제 화면에 보관 기간, 메일 1통의 링크로 PDF를 받고, 새 링크를 받으면 이전 링크는 만료 화면으로 간다', async ({ page, request, browser }) => {
  await toPreview(page);
  await page.getByTestId('delivery-pdf').uncheck();
  await page.getByTestId('delivery-email').check();
  const addr = `buyer-${Date.now()}@example.com`;
  await page.getByTestId('email').fill(addr);
  await toCheckout(page, []);
  await expect(page.getByTestId('checkout-retention')).toContainText('30일');
  await expect(page.getByTestId('checkout-retention')).toContainText('이메일 주소');
  await pay(page, 'success');
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('email-status')).toHaveAttribute('data-email-status', 'sent', { timeout: 30_000 });
  await expect(page.getByTestId('delivery-expiry')).toContainText('30일');
  await expect(page.getByTestId('pdf-download')).toHaveCount(0);
  const orderId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saju.order')!).orderId as string);

  const mails = async () => ((await (await request.get('/api/dev/outbox')).json()) as { messages: { to: string; orderId: string; text: string }[] }).messages.filter((m) => m.orderId === orderId);
  const first = await mails();
  expect(first).toHaveLength(1);
  expect(first[0]!.to).toBe(addr);
  expect(first[0]!.text).toContain('30일');
  const link1 = /https?:\/\/\S+\/api\/download\/\S+/.exec(first[0]!.text)![0];

  // 다른 기기(새 브라우저)에서 링크를 열면 PDF를 받는다
  const res = await request.get(link1, { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // 링크 다시 받기 → 새 메일, 이전 링크는 만료 화면
  const other = await browser.newPage();
  try {
    await other.goto('/resend');
    await other.getByTestId('resend-order-id').fill(orderId);
    await other.getByTestId('resend-email').fill(addr);
    await other.getByTestId('resend-submit').click();
    await expect(other.getByTestId('resend-message')).toContainText('주문번호와 이메일이 일치하면');
    await expect.poll(async () => (await mails()).length, { timeout: 15_000 }).toBe(2);
    await other.goto(link1);
    await expect(other.getByTestId('link-expired')).toBeVisible();
    await expectNoHorizontalScroll(other);
  } finally {
    await other.close();
  }
});

test('운영이 아닌 개발 서버에서만 개발용 메일 보관함이 열린다(운영 빌드 확인은 prod.spec.ts)', async ({ request }) => {
  expect((await request.get('/api/dev/outbox')).status()).toBe(200);
});

test('분 모름: 경계가 없는 시는 바로 진행하고, 경계가 있는 시는 한 줄 더 묻고, 모름이면 시주 없이 가능한 시주를 안내한다', async ({ page }) => {
  await fillBirth(page);
  await page.getByTestId('region-province').selectOption({ label: '서울' });
  await page.getByTestId('region-district').selectOption({ label: '종로구' });
  const minute = page.getByLabel('분', { exact: true });
  const submit = page.getByTestId('input-submit');
  const question = page.getByTestId('minute-boundary');

  // 14시: 그 시 안에 경계가 없다(1990-05-15 서울)
  await page.getByLabel('시', { exact: true }).selectOption('14');
  await minute.selectOption('unknown');
  await expect(submit).toBeEnabled();
  await expect(question).toHaveCount(0);

  // 13시: 33분부터 미시로 바뀐다 → 한 줄 더 묻는다
  await page.getByLabel('시', { exact: true }).selectOption('13');
  await expect(question).toContainText('13시 33분 이전인가요, 이후인가요?');
  await expect(submit).toBeDisabled();
  await expect(page.getByTestId('missing-fields')).toContainText('13시 33분 이전인지 이후인지 골라 주세요');
  await expect(question.getByRole('radio')).toHaveCount(3);
  await question.getByRole('radio', { name: /33분 이후/ }).check();
  await expect(submit).toBeEnabled();

  // 모름 → 시주 없이, 차트 아래에 분 구간별 시주 안내
  await question.getByRole('radio', { name: /^모름/ }).check();
  await submit.click();
  await expect(page.getByTestId('preview-document')).toBeVisible();
  await expect(page.getByTestId('preview-document')).toContainText('13시대(분 모름, 시주 제외)');
  const notices = page.getByTestId('chart-notices');
  await expect(notices).toContainText('분을 모르셔서 시주 없이 풀었어요');
  await expect(notices).toContainText('13:00~13:32 출생: 시주');
  await expect(notices).toContainText('13:33~13:59 출생: 시주');
  await expect(page.getByTestId('saju-chart')).toContainText('모름');
});

test('계산 오류 사례(가상 데이터): 음력 1967-07-01, 08시 분 모름, 경남 남해군, 남 → 미리보기까지', async ({ page }) => {
  await fillBirth(page, { calendar: 'lunar', year: '1967', month: '7', day: '1' });
  await page.getByLabel('시', { exact: true }).selectOption('8');
  await page.getByLabel('분', { exact: true }).selectOption('unknown');
  await page.getByLabel('남성').check();
  await page.getByTestId('region-province').selectOption({ label: '경남' });
  await page.getByTestId('region-district').selectOption({ label: '남해군' });
  // 08시는 남해(127.89°)에서 그 시 안에 경계가 없어 질문 없이 진행한다
  await expect(page.getByTestId('input-submit')).toBeEnabled();
  await expect(page.getByTestId('minute-boundary')).toHaveCount(0);
  const chart = page.waitForResponse('**/api/chart');
  await page.getByTestId('input-submit').click();
  expect((await chart).status()).toBe(200);
  await expect(page.getByTestId('preview-document')).toBeVisible();
  await expect(page.getByTestId('preview-document')).toContainText('음력 1967년 7월 1일 08시경(분 모름) · 남');
  await expect(page.getByTestId('preview-document')).toContainText('동경 127.89°');
});

test('서버가 오류 페이지를 돌려주면 서버 문제일 가능성을 알리고, 계속되면 확인할 입력을 안내한다', async ({ page }) => {
  await fillBirth(page);
  await page.route('**/api/chart', (route) => route.fulfill({ status: 500, contentType: 'text/html', body: '<!DOCTYPE html><html><body>Internal Server Error</body></html>' }));
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('calc-failed')).toContainText('서버의 일시적인 문제일 가능성이 커요');
  await expect(page.getByTestId('calc-retry')).toContainText('생년월일(양력·음력, 윤달), 태어난 시간, 태어난 지역');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('음력 2050년 끝 무렵은 입력 화면으로 돌아가 음력 마지막 날짜를 알려 준다', async ({ page }) => {
  await fillBirth(page, { calendar: 'lunar', year: '2050', month: '12', day: '15' });
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('screen-input')).toBeVisible();
  await expect(page.locator('#date-error')).toHaveText('음력으로는 2050년 11월 18일(양력 2050년 12월 31일)까지만 계산할 수 있어요. 그 전 날짜로 입력해 주세요.');
});

test('서버에 연결하지 못하면 연결을 확인하라고 안내한다', async ({ page }) => {
  await fillBirth(page);
  await page.route('**/api/chart', (route) => route.abort('internetdisconnected'));
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('calc-failed')).toHaveText('서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
