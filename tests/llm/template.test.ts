// 총평 템플릿: 모든 변형이 검증을 통과하고 근거 id·chartRefs가 유효해야 한다
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence, isValidChartRef } from '../../src/engine/evidence';
import type { SajuChart } from '../../src/engine/types';
import { COMMON_FORBIDDEN } from '../../src/llm/forbidden';
import { prepareRules, validateSection } from '../../src/llm/validate';
import { summaryTemplate } from '../../src/report/summaryTemplate';

/** 1950~2040년을 13일 간격으로 훑어 일간·오행 조합을 넓게 만든다 */
function sampleCharts(): SajuChart[] {
  const out: SajuChart[] = [];
  for (let t = Date.UTC(1950, 0, 1); t < Date.UTC(2040, 0, 1); t += 13 * 86_400_000) {
    const d = new Date(t);
    const hour = (d.getUTCDate() * 7) % 24;
    out.push(
      buildChart(
        { calendar: 'solar', isLeapMonth: false, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
          time: d.getUTCDate() % 5 === 0 ? null : { hour, minute: 10 }, gender: d.getUTCDate() % 2 ? 'male' : 'female' },
        { referenceYear: 2026 },
      ),
    );
  }
  return out;
}

describe('총평 템플릿', () => {
  const charts = sampleCharts();

  it('표본이 일간 10종과 오행 경우(과다·결핍·과다+결핍·고름·과다 2개)를 모두 덮는다', () => {
    const stems = new Set(charts.map((c) => c.pillars.day.stem));
    expect(stems.size).toBe(10);
    const kinds = new Set(
      charts.map((c) => {
        const v = Object.values(c.elements.counts);
        const max = Math.max(...v);
        const strong = v.filter((x) => x === max && max >= 3).length;
        const missing = v.filter((x) => x === 0).length;
        return strong > 1 ? 'multiStrong' : strong && missing ? 'strong+missing' : strong ? 'strong' : missing > 1 ? 'missing2+' : missing ? 'missing1' : 'balanced';
      }),
    );
    expect([...kinds].sort()).toEqual(['balanced', 'missing1', 'missing2+', 'multiStrong', 'strong', 'strong+missing'].sort());
  });

  it('모든 표본에서 문장이 검증을 통과하고 근거·chartRefs가 유효하다', () => {
    for (const chart of charts) {
      const evidence = buildEvidence(chart);
      const rules = prepareRules({ evidence, forbidden: COMMON_FORBIDDEN, maxChars: REPORT_LAYOUT.maxSentenceChars });
      const sentences = summaryTemplate(chart);
      expect(validateSection(sentences, 'summary', REPORT_LAYOUT.summaryTemplateSentences, rules)).toEqual([]);
      for (const s of sentences) {
        for (const id of s.evidenceIds) {
          const e = evidence.find((x) => x.id === id)!;
          expect(e.chartRefs.every((r) => isValidChartRef(chart, r))).toBe(true);
        }
      }
    }
  });

  it('같은 차트면 같은 문장', () => {
    expect(summaryTemplate(charts[3]!)).toEqual(summaryTemplate(charts[3]!));
  });

  it('쉬운 말로 쓰고, 조사가 받침에 맞는다 (갑·을·병·정·경·신·임 → "~이라", 무·기·계 → "~라")', () => {
    for (const c of charts) {
      const first = summaryTemplate(c)[0]!.text;
      expect(first).toMatch(/^나를 나타내는 글자가 (나무|불|흙|쇠|물)의 기운인 ([갑을병정경신임]\(.\)이라|[무기계]\(.\)라), /);
    }
    for (const c of charts) for (const s of summaryTemplate(c)) expect(s.text).not.toMatch(/일간|오행|[목화토금수]\(/);
    const lines = charts.map((c) => summaryTemplate(c)[1]!.text);
    expect(lines.some((t) => /흙이 \d개로/.test(t) || /쇠가 없/.test(t) || /나무가/.test(t))).toBe(true);
  });
});
