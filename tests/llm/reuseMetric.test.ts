// 근거 반복 지표 (D-023 C)
import { describe, expect, it } from 'vitest';
import { evidenceReuse, sumReuse } from '../../src/llm/reuseMetric';
import type { ReportBody } from '../../src/llm/types';

const s = (...ids: string[]) => ({ text: '문장이에요.', evidenceIds: ids });

describe('evidenceReuse', () => {
  const body: ReportBody = {
    // 앞 2문장은 템플릿이라 세지 않는다
    summary: [s('dayMaster'), s('elements.summary'), s('tenGodGroup.jaeseong'), s('dayMaster')],
    traits: [s('dayMaster', 'tenGod.month.stem'), s('tenGodGroup.jaeseong')],
    topics: { wealth: [s('tenGodGroup.jaeseong', 'daewoon[1]')], love: [s('pillar.day.branch')] },
    daewoonNotes: [{ daewoonIndex: 1, sentences: [s('daewoon[1]', 'dayMaster')] }],
    yearly: { thisYear: [s('seun[0]')], nextYear: [s('seun[1]')] },
  };

  it('칸 단위로 세고, 템플릿 문장과 대운·세운 근거는 빼다', () => {
    const r = evidenceReuse(body);
    // dayMaster: summary(AI)·traits·daewoon = 3칸, jaeseong: summary·traits·topic:wealth = 3칸
    expect(r).toEqual({ citedIds: 4, idsIn3PlusSections: 2, sectionSum: 3 + 3 + 1 + 1, dayMasterSections: 3 });
  });

  it('여러 리포트를 합치고 평균을 낸다', () => {
    const total = sumReuse([evidenceReuse(body), evidenceReuse(body)]);
    expect(total).toMatchObject({ citedIds: 8, idsIn3PlusSections: 4, sectionSum: 16, avgSectionsPerId: 2 });
  });
});
