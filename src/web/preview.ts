// 무료 미리보기 (POST /api/chart). AI를 부르지 않는다.
// 응답에는 표지·사주 차트·오행 분포·총평 템플릿 문장과 그 근거, 잠긴 섹션의 "제목"만 담는다(SPEC 1장).
// 대운·세운 목록은 잠긴 "대운 흐름·올해·내년 흐름"에 속하므로 미리보기에서 뺀다.
import { CalendarInputError } from '../engine/calendar';
import { buildChart } from '../engine/chart';
import { buildEvidence } from '../engine/evidence';
import { isChildChart } from '../report/audience';
import { summaryTemplate } from '../report/summaryTemplate';
import { birthLabelOf, buildPreviewView, type PreviewView } from '../report/view';
import { engineErrorToField, type FieldErrors } from './birthForm';
import { validateBirthFormOnServer } from './birthServer';

export function buildPreview(raw: unknown, now = new Date()): { ok: true; view: PreviewView } | { ok: false; errors: FieldErrors } {
  const v = validateBirthFormOnServer(raw);
  if (!v.ok) return v;
  const referenceYear = new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
  try {
    const chart = buildChart(v.value.input, { referenceYear });
    // 결제 후 리포트와 같은 기준(만 13세 미만이면 아이 리포트 문장·사실 카드·근거 문구)으로 만든다(D-044·D-045·D-051)
    const child = isChildChart(chart, now);
    const evidence = buildEvidence(chart, { child });
    const view = buildPreviewView({
      chart,
      evidence,
      summary: summaryTemplate(chart, { child }),
      child,
      name: v.value.name,
      birthLabel: birthLabelOf(v.value.input, v.value.timeText),
    });
    return { ok: true, view: { ...view, chart: { ...view.chart, daewoon: [], seun: [] } } };
  } catch (e) {
    if (e instanceof CalendarInputError) return { ok: false, errors: engineErrorToField(e.code, v.value.input) };
    throw e;
  }
}
