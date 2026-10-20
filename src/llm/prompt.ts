// 프롬프트: 공통 시스템 프롬프트 하나 + 호출별 사용자 메시지(근거 목록과 작성할 칸).
// 시스템 프롬프트는 바뀌지 않으므로 캐시된다. 출생 정보 원문은 넣지 않고 Evidence만 넘긴다.
import { REPORT_LAYOUT } from '../config/report';
import type { TopicConfig } from '../config/topics';
import type { Evidence } from '../engine/types';
import type { ReportSentence, Violation } from './types';

/** 풀이 톤 (사업자 결정 2026-10-20: 기본값 고정, 선택 옵션 없음) */
export const TONE =
  '차분한 조언형 존댓말(해요체)로 씁니다. 불안을 키우는 단정은 하지 않고 "~한 편이에요", "~로 볼 수 있어요"처럼 경향으로 말합니다. ' +
  '각 칸(섹션)마다 1~2문장은 생활에서 해 볼 수 있는 구체적인 행동 제안으로 씁니다.';

export const SYSTEM_PROMPT = [
  '당신은 사주 리포트의 풀이 문장을 쓰는 작가입니다. 사주 계산은 이미 코드가 끝냈고, 당신은 주어진 근거 목록만 보고 글을 씁니다.',
  '',
  '## 규칙',
  '1. 모든 문장은 근거 목록의 id를 evidenceIds에 1개 이상 담습니다. 목록에 없는 id는 쓰지 않습니다.',
  '2. 문장에 쓰는 간지·십신·오행 값은 그 문장이 인용한 근거의 내용에 실제로 있는 것만 씁니다. 근거에 없는 간지·십신을 지어내거나 추측하지 않습니다.',
  '3. 천간·지지·간지는 반드시 한글과 한자를 함께 씁니다. 예: 갑(甲), 자(子), 갑자(甲子). 십신은 근거에 적힌 이름(비견, 정재 등) 그대로 씁니다.',
  '4. 질병·건강 진단, 투자·금융 상품 권유, 사망·사고·재앙에 대한 말, 결과를 장담하거나 불안을 키우는 단정은 쓰지 않습니다. 정확도나 적중을 내세우지 않습니다.',
  `5. text 하나에는 문장을 하나만 씁니다(마침표로 끝나는 문장 1개). 문장 하나는 ${REPORT_LAYOUT.maxSentenceChars}자 이내입니다. 요청한 문장 수를 정확히 지킵니다.`,
  '6. 이 리포트는 오락·참고용입니다. 의료·투자·법률 판단처럼 읽힐 수 있는 표현은 피합니다.',
  '7. 출생 날짜·시각·이름 같은 개인 정보는 언급하지 않습니다(근거 목록에도 없습니다).',
  '8. 연도·월·나이 같은 숫자는 인용한 근거에 적힌 값만 씁니다. 대운의 시작 시점은 근거에 적힌 "K세(YYYY년 M월)" 표기를 그대로 씁니다. 나이만(28세·28살), 연·월만(2026년 6월) 따로 쓰거나 "무렵·중순" 같은 근사 표현을 덧붙이지 않습니다. 세운 연도는 "2026년"처럼 그대로 씁니다.',
  '',
  '## 톤',
  TONE,
  '',
  '## 출력',
  'JSON 스키마에 맞춰 출력합니다. 각 문장은 { "text": 문장, "evidenceIds": [근거 id, ...] } 형식입니다.',
].join('\n');

function evidenceBlock(evidence: readonly Evidence[]): string {
  const rows = evidence.map((e) => ({ id: e.id, kind: e.kind, content: e.content }));
  return `## 근거 목록\n${JSON.stringify(rows, null, 1)}`;
}

function retryNote(violations: readonly Violation[]): string {
  if (!violations.length) return '';
  const lines = violations.slice(0, 20).map((v) => `- ${v.path}: ${v.detail}`);
  return `\n\n## 이전 응답이 어긴 규칙\n이전 응답은 아래 이유로 거부됐습니다. 같은 실수를 하지 않도록 처음부터 다시 씁니다.\n${lines.join('\n')}`;
}

export function baseUserMessage(args: {
  evidence: readonly Evidence[];
  templateSummary: readonly ReportSentence[];
  daewoonIndices: readonly number[];
  thisYear: number;
  violations?: readonly Violation[];
}): string {
  const L = REPORT_LAYOUT;
  const template = args.templateSummary.map((s) => `- ${s.text}`).join('\n');
  return [
    evidenceBlock(args.evidence),
    '',
    '## 작성할 칸',
    `- summary: 총평. 아래 두 문장 뒤에 이어질 ${L.summaryAiSentences}문장. 앞 문장을 반복하지 말고 자연스럽게 이어 씁니다.`,
    template,
    `- traits: 타고난 성향 ${L.traitsSentences}문장. 일간·십신·오행·합충 근거를 씁니다.`,
    `- daewoonNotes: 대운 흐름. daewoonIndex ${args.daewoonIndices.join(', ')} 순서로 각 ${L.daewoonNoteSentences}문장. 해당 대운 근거(daewoon[n])를 꼭 인용합니다.`,
    `- yearly.thisYear: ${args.thisYear}년 흐름 ${L.yearlySentences}문장 (seun[0] 인용).`,
    `- yearly.nextYear: ${args.thisYear + 1}년 흐름 ${L.yearlySentences}문장 (seun[1] 인용).`,
  ].join('\n') + retryNote(args.violations ?? []);
}

export function topicUserMessage(args: {
  topic: TopicConfig;
  evidence: readonly Evidence[];
  violations?: readonly Violation[];
}): string {
  return [
    evidenceBlock(args.evidence),
    '',
    `## 작성할 칸: ${args.topic.label} 풀이`,
    `- sentences: ${REPORT_LAYOUT.topicSentences}문장`,
    `- 지침: ${args.topic.guidance}`,
  ].join('\n') + retryNote(args.violations ?? []);
}
