// 화면 흐름 테스트 공통 동작
import { expect, type Page } from '@playwright/test';

export interface BirthOpts {
  calendar?: 'solar' | 'lunar';
  leap?: boolean;
  year?: string;
  month?: string;
  day?: string;
  timeUnknown?: boolean;
  name?: string;
}

/** 화면 1 → 2: 정보를 채우고 "내 사주 보기" */
export async function fillBirth(page: Page, o: BirthOpts = {}): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('screen-input')).toBeVisible();
  if (o.name) await page.getByLabel('이름').fill(o.name);
  // 같은 탭에서 다시 오면 이전 입력이 되살아나므로 모든 칸을 명시적으로 정한다
  await page.getByLabel(o.calendar === 'lunar' ? '음력' : '양력').check();
  if (o.calendar === 'lunar') await page.getByTestId('leap-month').setChecked(!!o.leap);
  await page.getByLabel('태어난 해').fill(o.year ?? '1990');
  await page.getByLabel('태어난 달').fill(o.month ?? '5');
  await page.getByLabel('태어난 날').fill(o.day ?? '15');
  await page.getByTestId('time-unknown').setChecked(!!o.timeUnknown);
  if (!o.timeUnknown) {
    await page.getByLabel('시', { exact: true }).selectOption('14');
    await page.getByLabel('분', { exact: true }).selectOption('30');
  }
  await page.getByLabel('여성').check();
  await page.getByTestId('consent').check();
}

/** 화면 2 → 3 → 4 */
export async function toPreview(page: Page, o: BirthOpts = {}): Promise<void> {
  await fillBirth(page, o);
  await page.getByTestId('input-submit').click();
  await expect(page.getByTestId('preview-document')).toBeVisible();
}

/** 화면 4 → 5 */
export async function toCheckout(page: Page, topics: string[] = ['wealth']): Promise<void> {
  for (const t of topics) await page.getByTestId(`topic-${t}`).check();
  // 개발 서버는 결제 화면을 처음 열 때 컴파일하느라 기본 대기(5초)를 넘길 때가 있었다(가끔 실패). 주소가 바뀌는 것과 화면이 뜨는 것을 넉넉히 기다린다
  await Promise.all([page.waitForURL(/\/checkout(\?|$)/, { timeout: 60_000 }), page.getByTestId('preview-next').click()]);
  await expect(page.getByTestId('screen-checkout')).toBeVisible({ timeout: 30_000 });
}

/** 화면 5에서 결제하기 → 목 결제창에서 인증(개발 서버의 목 결제 어댑터, D-028) */
export async function pay(
  page: Page,
  outcome: 'success' | 'fail' | 'success-genfail' = 'success',
  opts: { method?: string; amount?: number } = {},
): Promise<void> {
  await page.getByTestId('agree-terms').check();
  if (opts.method) await page.getByTestId(`method-${opts.method}`).locator('input').check();
  await page.getByTestId('pay-button').click();
  await expect(page.getByTestId('mock-pg')).toBeVisible();
  if (opts.amount !== undefined) await page.getByTestId('mock-pg-amount').fill(String(opts.amount));
  await page.getByTestId(`mock-pg-${outcome}`).check();
  await page.getByTestId('mock-pg-submit').click();
}

/** 가로 스크롤이 생기지 않았는지 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** 공통 푸터(사업자 정보·약관 링크) */
export async function expectFooter(page: Page): Promise<void> {
  const f = page.getByTestId('site-footer');
  await expect(f).toBeVisible();
  await expect(f).toContainText('사업자등록번호');
  for (const name of ['이용약관', '환불 규정', '개인정보 처리방침']) await expect(f.getByRole('link', { name })).toBeVisible();
}
