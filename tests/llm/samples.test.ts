// Phase 2 완료 기준 중 코드로 확인하는 항목 (샘플 10건)
// - 같은 입력이면 같은 SajuChart와 Evidence[]
// - 모든 Evidence에 chartRefs가 있고 차트의 유효한 위치를 가리킴
// - 주제별 근거도 마찬가지
import { describe, expect, it } from 'vitest';
import { TOPICS } from '../../src/config/topics';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence, isValidChartRef } from '../../src/engine/evidence';
import { topicEvidence } from '../../src/llm/evidenceSelect';
import { SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';

describe.each(SAMPLE_INPUTS.map((input, i) => ({ i, input })))('샘플 $i', ({ input }) => {
  const chart = buildChart(input, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);

  it('같은 입력이면 같은 차트와 근거', () => {
    const again = buildChart(structuredClone(input), { referenceYear: SAMPLE_REFERENCE_YEAR });
    expect(again).toEqual(chart);
    expect(buildEvidence(again)).toEqual(evidence);
  });

  it('모든 근거에 유효한 chartRefs가 있다', () => {
    for (const e of evidence) {
      expect(e.chartRefs.length, e.id).toBeGreaterThan(0);
      for (const r of e.chartRefs) expect(isValidChartRef(chart, r), `${e.id} → ${r}`).toBe(true);
    }
  });

  it('주제별 근거는 전체 근거의 부분집합이고 공통 근거를 포함한다', () => {
    const ids = new Set(evidence.map((e) => e.id));
    for (const topic of TOPICS) {
      const sub = topicEvidence(topic, chart, evidence);
      expect(sub.every((e) => ids.has(e.id))).toBe(true);
      expect(sub.map((e) => e.id)).toEqual(expect.arrayContaining(['dayMaster', 'elements.summary', 'seun[0]', 'seun[1]']));
    }
  });
});

describe('주제 설정 검증', () => {
  it('evidence.ids와 relationsTouching이 실제로 있을 수 있는 근거·위치를 가리킨다', () => {
    const allIds = new Set(
      SAMPLE_INPUTS.flatMap((input) => buildEvidence(buildChart(input, { referenceYear: SAMPLE_REFERENCE_YEAR })).map((e) => e.id)),
    );
    const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
    for (const topic of TOPICS) {
      for (const id of topic.evidence.ids) expect(allIds.has(id), `${topic.id}: ${id}`).toBe(true);
      for (const ref of topic.evidence.relationsTouching) expect(isValidChartRef(chart, ref), `${topic.id}: ${ref}`).toBe(true);
      for (const f of topic.extraForbidden) expect(() => new RegExp(f.pattern, 'u')).not.toThrow();
    }
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
  });
});
