// Phase 3 완료 기준을 화면에서 확인한다(개발 서버, 가짜 결제·가짜 LLM).
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
  await expect(page.getByTestId('method-tosspay')).toContainText('준비 중');
  await pay(page, 'success');

  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  await expectFooter(page);
  await expectNoHorizontalScroll(page);
  // 같은 템플릿: 잠겼던 섹션이 같은 제목으로 열린다
  const sections = await page.locator('[data-testid="report-document"] [data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  expect(sections).toEqual(['summary', 'traits', 'topics', 'daewoon', 'yearly', 'disclaimer']);
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
  await expect(page.getByTestId('missing-fields')).toContainText('생년월일');
  await expect(page.getByTestId('leap-month')).toHaveCount(0);
  await page.getByLabel('음력').check();
  await expect(page.getByTestId('leap-month')).toBeVisible();
  await page.getByLabel('태어난 해').fill('1800');
  await page.getByLabel('태어난 해').blur();
  await expect(page.getByText('1900~2050년 사이로 입력해 주세요.')).toBeVisible();
  await page.getByTestId('time-unknown').check();
  await expect(page.getByLabel('시', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('분', { exact: true })).toBeDisabled();
  await page.getByTestId('consent').check();
  await page.getByTestId('consent').uncheck();
  await expect(page.getByText('개인정보 수집·이용에 동의해 주세요.')).toBeVisible();
});

test('음력 윤달 + 시간 모름으로 미리보기까지, 없는 윤달은 서버 검증 문구로 돌아온다', async ({ page }) => {
  // 2020년 음력 윤4월은 있다
  await toPreview(page, { calendar: 'lunar', leap: true, year: '2020', month: '4', day: '10', timeUnknown: true });
  await expect(page.getByTestId('saju-chart')).toContainText('모름');
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

  const btn = page.locator('[data-section="summary"] .ref-button').first();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('selected-evidence')).toBeVisible();
  expect(await page.locator('.is-highlighted').count()).toBeGreaterThan(0);
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

test('리포트 근거 버튼: 키보드로 누르면 강조, 다른 문장을 누르면 강조가 옮겨 간다', async ({ page }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await pay(page);
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  const buttons = page.locator('[data-testid="report-document"] .ref-button');
  const first = buttons.first();
  // 다른 근거를 가리키는 버튼을 찾는다
  const firstN = await first.getAttribute('data-ref-n');
  const other = page.locator(`[data-testid="report-document"] .ref-button:not([data-ref-n="${firstN}"])`).first();

  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  const before = await page.locator('.is-highlighted').evaluateAll((els) => els.map((e) => e.getAttribute('data-ref')));
  expect(before.length).toBeGreaterThan(0);

  await other.focus();
  await page.keyboard.press('Space');
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  const after = await page.locator('.is-highlighted').evaluateAll((els) => els.map((e) => e.getAttribute('data-ref')));
  expect(after).not.toEqual(before);
  await expect(page.getByTestId('selected-evidence')).toContainText(`근거 ${await other.getAttribute('data-ref-n')}`);
  // 강조는 색이 아니라 테두리(outline)로도 구분된다
  const outline = await page.locator('.is-highlighted').first().evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(outline).toBe('solid');
});

test('PDF: 번호와 "풀이 근거 목록"이 화면과 일치하고 Noto 글꼴이 들어간다', async ({ page }) => {
  await toPreview(page);
  await toCheckout(page, ['career']);
  await pay(page);
  await expect(page.getByTestId('screen-report')).toBeVisible({ timeout: 30_000 });
  const screenList = await page.locator('[data-testid="evidence-list"] li').allTextContents();

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
  const printList = await print.locator('[data-testid="evidence-list"] li').allTextContents();
  expect(printList.map((t) => t.replace(/^\S+ · /, ''))).toEqual(screenList.map((t) => t.replace(/^근거 \d+ · /, '')));
  expect(printList[0]).toMatch(/^① · /);
  const sections = await print.locator('[data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  expect(sections).toEqual(['summary', 'traits', 'topics', 'daewoon', 'yearly', 'disclaimer']);
  expect(await print.locator('.ref-button').count()).toBe(0);
  expect(await print.locator('.ref-num').count()).toBeGreaterThan(0);
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
  await expect(page.getByTestId('pay-failure-reason')).toContainText('승인되지 않았습니다');
  await expectFooter(page);
  await page.getByRole('link', { name: '미리보기로 돌아가기' }).click();
  await expect(page.getByRole('heading', { name: '김철수님의 사주' })).toBeVisible();
  await expect(page.getByTestId('topic-love')).toBeChecked();
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
  await expect(page.getByTestId('refund-submit')).toBeDisabled();
  await page.getByTestId('refund-email').fill('bad');
  await expect(page.getByText('처리 결과를 받을 이메일 주소를 정확히 입력해 주세요.')).toBeVisible();
  await page.getByTestId('refund-email').fill('a@example.com');
  await page.getByTestId('refund-submit').click();
  await expect(page.getByTestId('screen-refund-done')).toBeVisible();
  await expect(page.getByTestId('refund-id')).toHaveText(/^RF\d{8}-/);
  await expect(page.getByTestId('screen-refund-done')).toContainText(orderId);
  await expectFooter(page);
});

test('오류 C: 만료 링크 → 링크 다시 받기, 같은 안내 문구', async ({ page }) => {
  await page.goto('/api/download/expired-token');
  await expect(page.getByTestId('screen-resend')).toBeVisible();
  await expect(page.getByTestId('link-expired')).toBeVisible();
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
