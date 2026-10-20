// 한국천문연구원 특일 정보 API(data.go.kr 15012690)에서 24절기 시각을 받아 테스트용 fixture로 저장한다.
// 사용: npm run fetch:kasi [-- 2011 2024]  (.env의 DATAGOKR_API_KEY 사용, API는 2000~2028년만 응답)
// 런타임 엔진은 이 API를 쓰지 않는다. 키는 환경변수로만 받고 출력·파일에 남기지 않는다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/get24DivisionsInfo';
// API가 응답하는 연도 전체(2026-10-20 확인: 2000~2028년, 그 밖은 빈 응답)
const DEFAULT_YEARS = Array.from({ length: 2028 - 2000 + 1 }, (_, i) => 2000 + i);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/kasi-jie.json');

interface KasiItem {
  dateName: string;
  locdate: number | string;
  kst?: string | number;
}

function requireKey(): string {
  const key = process.env.DATAGOKR_API_KEY;
  if (!key) throw new Error('DATAGOKR_API_KEY가 설정되지 않았습니다');
  return key;
}

async function fetchYear(key: string, year: number): Promise<KasiItem[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('solYear', String(year));
  url.searchParams.set('numOfRows', '50');
  url.searchParams.set('_type', 'json');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${year}년 조회 실패: HTTP ${res.status}`);
  const body = (await res.json()) as { response?: { body?: { items?: { item?: KasiItem | KasiItem[] } } } };
  const item = body.response?.body?.items?.item;
  if (!item) throw new Error(`${year}년 응답에 절기 항목이 없습니다`);
  return Array.isArray(item) ? item : [item];
}

/** kst 필드(HHMM)와 locdate(YYYYMMDD)를 검증해 정규화한다. 형식이 다르면 멈춘다 */
function normalize(year: number, item: KasiItem) {
  const locdate = String(item.locdate);
  // kst가 비었거나 자리수가 다르면 "0000"처럼 메우지 않고 멈춘다
  const kst = String(item.kst ?? '').trim();
  const validClock = /^\d{4}$/.test(kst) && Number(kst.slice(0, 2)) < 24 && Number(kst.slice(2, 4)) < 60;
  if (!/^\d{8}$/.test(locdate) || !validClock) {
    throw new Error(`예상과 다른 응답 형식 (${year} ${item.dateName}): locdate=${locdate}, kst=${kst}`);
  }
  return {
    year,
    name: item.dateName.trim(),
    date: `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`,
    time: `${kst.slice(0, 2)}:${kst.slice(2, 4)}`,
  };
}

async function main(): Promise<void> {
  const key = requireKey();
  const years = process.argv.slice(2).map(Number).filter(Number.isInteger);
  const targets = years.length ? years : DEFAULT_YEARS;
  const items = [];
  for (const year of targets) {
    const raw = await fetchYear(key, year);
    items.push(...raw.map((r) => normalize(year, r)));
    process.stdout.write(`${year}: ${raw.length}건\n`);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  const fixture = {
    source: 'data.go.kr 15012690 한국천문연구원 특일 정보 get24DivisionsInfo',
    fetchedAt: new Date().toISOString(),
    items,
  };
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  process.stdout.write(`저장: ${OUT}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
