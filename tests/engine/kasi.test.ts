// 절입 시각을 한국천문연구원 24절기 시각(분 단위)과 대조한다(Docs/decisions.md D-012).
// fixture(tests/fixtures/kasi-jie.json)는 저장소에 포함하며 `npm run fetch:kasi`로 다시 받는다.
// fixture가 없거나 줄어들면 건너뛰지 않고 실패한다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JIE_TERMS, jieOfYear } from '../../src/engine/solarTerms';

const FIXTURE = join(import.meta.dirname, '../fixtures/kasi-jie.json');
const TOLERANCE_MIN = 1; // 천문연은 분 단위로 발표, 라이브러리는 초 단위 → 반올림 차이 허용
const JIE_NAMES: readonly string[] = JIE_TERMS.map((t) => t.ko);
/** API가 응답하는 2000~2028년 × 12절. 연도 범위를 바꾸면 같이 고친다 */
const EXPECTED_JIE_ROWS = 29 * 12;

interface KasiFixtureItem {
  year: number;
  name: string;
  date: string;
  time: string;
}

interface KnownApiError {
  year: number;
  name: string;
  /** 오류로 판정한 천문연 값이 들어 있어야 하는 한국 시각 범위 [시작, 끝] (양끝 포함) */
  kasiRange: readonly [string, string];
  /** 엔진 값이 들어 있어야 하는 한국 시각 범위 (독립 계산 03:31:15 ±15분) */
  engineRange: readonly [string, string];
}

/**
 * 천문연 API 데이터 오류로 판정한 행. 연도·이름·천문연 시각이 모두 범위에 맞을 때만 예외로 본다.
 * 천문연이 값을 고치면 예외 검사가 실패하므로 그때 목록에서 지운다.
 */
const KNOWN_KASI_API_ERRORS: readonly KnownApiError[] = [
  { year: 2011, name: '입동', kasiRange: ['2011-11-08 09:21', '2011-11-08 09:31'], engineRange: ['2011-11-08 03:16', '2011-11-08 03:46'] },
];

function loadItems(): KasiFixtureItem[] {
  if (!existsSync(FIXTURE)) return [];
  return (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { items: KasiFixtureItem[] }).items;
}

const jieItems = loadItems().filter((i) => JIE_NAMES.includes(i.name));

function kstMs(dateTime: string): number {
  return Date.parse(`${dateTime.replace(' ', 'T')}:00+09:00`);
}

function itemMs(item: KasiFixtureItem): number {
  return kstMs(`${item.date} ${item.time}`);
}

function inRange(ms: number, [from, to]: readonly [string, string]): boolean {
  return ms >= kstMs(from) && ms <= kstMs(to);
}

function engineMs(item: KasiFixtureItem): number {
  const mine = jieOfYear(Number(item.date.slice(0, 4))).find((j) => j.name === item.name);
  if (!mine) throw new Error(`${item.name}을(를) 엔진에서 찾지 못함`);
  return mine.instantMs;
}

/** 예외로 볼 행인가: 연도·이름이 같고 천문연 시각이 오류 범위 안일 때만 */
function excuseFor(item: KasiFixtureItem): KnownApiError | undefined {
  return KNOWN_KASI_API_ERRORS.find(
    (e) => e.year === item.year && e.name === item.name && inRange(itemMs(item), e.kasiRange),
  );
}

describe('한국천문연구원 24절기 시각 대조', () => {
  it('fixture가 있고 2000~2028년 12절이 모두 들어 있다', () => {
    expect(existsSync(FIXTURE), 'tests/fixtures/kasi-jie.json이 없음: npm run fetch:kasi').toBe(true);
    expect(jieItems.length).toBe(EXPECTED_JIE_ROWS);
  });

  it('같은 연도·절기 행이 하나씩만 있다', () => {
    const keys = jieItems.map((i) => `${i.year} ${i.name}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it.each(jieItems.filter((i) => !excuseFor(i)))('$year $name $date $time', (item) => {
    expect(Math.abs(engineMs(item) - itemMs(item)) / 60_000).toBeLessThanOrEqual(TOLERANCE_MIN);
  });

  it.each(KNOWN_KASI_API_ERRORS)('알려진 API 오류 $year $name: 오류 값이 그대로 있고 엔진은 정상 범위', (known) => {
    const rows = jieItems.filter((i) => i.year === known.year && i.name === known.name);
    expect(rows, 'fixture에 해당 행이 정확히 1개 있어야 함').toHaveLength(1);
    const row = rows[0]!;
    expect(inRange(itemMs(row), known.kasiRange), '천문연 값이 바뀜: 결정 기록 확인 후 예외 목록에서 지울 것').toBe(true);
    expect(inRange(engineMs(row), known.engineRange), '엔진 값이 독립 계산 범위를 벗어남').toBe(true);
    expect(Math.abs(engineMs(row) - itemMs(row)) / 60_000).toBeGreaterThan(TOLERANCE_MIN);
  });
});
