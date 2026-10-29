// 프롬프트: 공통 시스템 프롬프트 하나 + 호출별 사용자 메시지(근거 목록과 작성할 칸).
// 시스템 프롬프트는 바뀌지 않으므로 캐시된다. 출생 정보 원문은 넣지 않고 Evidence만 넘긴다.
import { REPORT_LAYOUT } from '../config/report';
import type { TopicConfig } from '../config/topics';
import { TEN_GOD_GROUPS, TEN_GOD_KO } from '../engine/constants';
import type { Evidence } from '../engine/types';
import type { Audience } from '../report/audience';
import { JARGON_WORDS } from './jargon';
import type { ReportSentence, Violation } from './types';

/** 풀이 톤 (사업자 결정 2026-10-20: 기본값 고정, 선택 옵션 없음) */
export const TONE =
  // D-045: "차분"이 한 리포트에 되풀이되는 풀이 말이라 톤 설명에서도 뺐다
  '부드러운 조언형 존댓말(해요체)로 씁니다. 불안을 키우는 단정은 하지 않고 "~한 편이에요", "~로 볼 수 있어요"처럼 경향으로 말합니다. ' +
  '각 칸(섹션)마다 1~2문장은 생활에서 해 볼 수 있는 구체적인 행동 제안으로 씁니다. ' +
  // D-043: 측정에서 행동 제안의 대부분이 어느 사주에나 붙는 일반 조언(대화 늘리기·산책·기록하기)이었다
  '행동 제안도 이 사람의 사실(그 문장이 인용한 근거의 글자·기운·뜻·시기)과 이어서 쓰고, 그 사실 때문에 이 제안이 맞는 이유가 문장에 드러나게 합니다. ' +
  // 예문을 두면 모델이 그대로 옮겨 써서(측정에서 확인) 예문 없이 방법만 적는다
  '이어 쓸 사실은 그 문장이 인용한 근거에 적힌 기운·뜻·개수로 쓰고, 다른 사주나 다른 해의 기운을 가져오지 않습니다. 같은 리포트 안에서 같은 조언을 되풀이하지 않습니다. ' +
  '근거와 상관없이 누구에게나 할 수 있는 조언(대화 시간 늘리기, 산책, 기록·메모 습관 같은 말만 하는 문장)은 쓰지 않습니다.';

/**
 * 쉬운 말 바꾸기 표(D-042). 이 리포트는 사주를 처음 보는 사람이 읽는다.
 * 근거 목록은 전문 표기로 주고(검증용), 문장은 이 표대로 쉬운 말로 쓰게 한다. 남은 전문 용어는 validate.ts가 잡아 다시 생성한다.
 */
export const PLAIN_WORDS = [
  '## 쉬운 말 (이 리포트는 사주를 처음 보는 사람이 읽습니다)',
  '근거 목록은 전문 표기로 적혀 있습니다. 문장에는 아래처럼 바꿔 씁니다.',
  '- 일간 → 나를 나타내는 글자 (문맥에 따라 "나")',
  '- 원국 → 내 사주 N글자 (N은 인용한 근거에 적힌 글자 수 그대로)',
  '  예: "원국 8글자 중 3개" → "내 사주 8글자 중 3개", "원국 8글자 중 일간(나를 나타내는 글자)을 뺀 7글자에서 2개" → "나를 뺀 7글자 중 2개"',
  // D-044: "나를 나타내는 글자를 뺀 7글자에서 N개"가 한 리포트에 4~5번씩 같은 꼴로 나와 기계적으로 읽혔다
  // D-045: 예로 준 "나를 나타내는 글자 말고 7글자 가운데"가 어색하다는 판정을 받아 짧은 꼴만 둔다
  '  개수 표현은 같은 꼴을 되풀이하지 않고 짧게 번갈아 씁니다: "나를 뺀 7글자 중 2개", "내 사주 8글자 중 2개", 또는 기준 수 없이 "2개나 있어서". 기준 글자 수는 한 칸에서 한 번만 밝히고, "8글자 중 나를 뺀 7글자에서"처럼 두 수를 함께 쓰지 않습니다.',
  '  0개는 숫자로 쓰지 않고 "하나도 없어서", "찾아볼 수 없어서", "보이지 않아서"처럼 자연스럽게 씁니다.',
  '- 년주·월주·일주·시주 → 태어난 해·태어난 달·태어난 날·태어난 시',
  '- 천간 → 윗글자, 지지 → 아랫글자. 예: 년주 천간 을(乙) → 태어난 해의 윗글자 을(乙)',
  '- 오행 목·화·토·금·수 → 나무·불·흙·쇠·물의 기운. 토(土)·임수(壬水) 같은 한자 오행 표기는 쓰지 않습니다.',
  `- 십신은 다섯 가지 뜻 표기로만 씁니다(가운뎃점까지 그대로): ${TEN_GOD_GROUPS.map((g) => `${g.members.map((m) => TEN_GOD_KO[m]).join('·')}(${g.ko}) → ${g.plain}`).join(', ')}.`,
  '  예: "년주 천간 을(乙)은 상관" → "태어난 해의 윗글자 을(乙)은 표현·재능을 뜻하는 글자라, …"',
  '  예: "관성 3개" → "규칙·책임을 뜻하는 글자가 3개 있어서, …", "인성 0개" → "배움·보살핌을 뜻하는 글자가 없어서, …"',
  '- 대운 → 10년 단위의 큰 흐름. 예: "61세(만 59세, 2025년 6월)부터 이어지는 정축(丁丑)의 큰 흐름은 …"',
  '- 세운 → 그해의 흐름. 예: "2026년은 병오(丙午)의 해라, …"',
  '  대운·세운의 기운(나무·불 등)은 그 대운·세운 근거에 적힌 천간·지지 오행만 씁니다. 그 기운을 내 사주와 견줄 때(예: "내 사주에 없던 쇠의 기운")는 그 기운의 원국 근거(elements.*)도 함께 인용합니다.',
  '  다섯 가지 뜻 표기는 그 십신이 있는 근거를 인용한 문장에서만 씁니다. 일반 조언에는 쓰지 않습니다.',
  '- 합 → 서로 묶이는 관계, 충 → 서로 부딪치는 관계',
  '- 음양, 순행·역행은 문장에 쓰지 않습니다.',
  `- 문장에 쓰지 않는 말: ${JARGON_WORDS.join(', ')}`,
].join('\n');

export const SYSTEM_PROMPT = [
  '당신은 사주 리포트의 풀이 문장을 쓰는 작가입니다. 사주 계산은 이미 코드가 끝냈고, 당신은 주어진 근거 목록만 보고 글을 씁니다.',
  '',
  '## 규칙',
  '1. 모든 문장은 근거 목록의 id를 evidenceIds에 1개 이상 담습니다. 목록에 없는 id는 쓰지 않습니다.',
  '2. 문장에 쓰는 글자·기운·뜻(표현·재능 등) 값은 그 문장이 인용한 근거의 내용에 실제로 있는 것만 씁니다. 근거에 없는 글자나 십신을 지어내거나 추측하지 않습니다. 글자의 자리를 시기나 사람으로 바꿔 말하지 않습니다(태어난 해 → 어린 시절, 태어난 날의 아랫글자 → 배우자 자리, 태어난 시 → 인생 후반 같은 해석은 근거에 없습니다).',
  '3. 글자(간지)는 반드시 한글과 한자를 함께 씁니다. 예: 갑(甲), 자(子), 갑자(甲子).',
  '4. 질병·건강 진단, 투자·금융 상품 권유, 사망·사고·재앙에 대한 말, 결과를 장담하거나 불안을 키우는 단정은 쓰지 않습니다. 정확도나 적중을 내세우지 않습니다.',
  `5. text 하나에는 문장을 하나만 씁니다(마침표로 끝나는 문장 1개). 문장 하나는 ${REPORT_LAYOUT.maxSentenceChars}자 이내입니다. 요청한 문장 수를 정확히 지킵니다.`,
  '6. 이 리포트는 오락·참고용입니다. 의료·투자·법률 판단처럼 읽힐 수 있는 표현은 피합니다.',
  '7. 출생 날짜·시각·이름 같은 개인 정보는 언급하지 않습니다(근거 목록에도 없습니다).',
  '8. 연도·월·나이 같은 숫자는 인용한 근거에 적힌 값만 씁니다. 대운의 시작 시점은 근거에 적힌 "K세(만 N세, YYYY년 M월)" 표기를 그대로 씁니다. 나이만(28세·28살), 연·월만(2026년 6월) 따로 쓰거나 "무렵·중순" 같은 근사 표현을 덧붙이지 않습니다. 세운 연도는 "2026년"처럼 그대로 씁니다. 개수(3개, 7글자)도 인용한 근거에 적힌 값만 숫자로 씁니다. 뜻 묶음(~을 뜻하는 글자)의 개수는 나를 뺀 글자 수에서 셉니다(8글자 사주면 "나를 뺀 7글자 중"). 생활 조언에도 근거에 없는 개수("세 가지", "두 번")를 만들어 넣지 않습니다.',
  '9. 전문 용어는 문장에 쓰지 않고 아래 "쉬운 말"로 바꿔 씁니다.',
  // D-045: "불의 기운이 두 배로 더해지니", "불의 기운처럼 서두르는 지출", "묶이는 관계라 부모와 가까이 붙어 지낸다"가 나왔다
  '10. 기운의 양은 근거의 개수대로만 말합니다. "두 배로"처럼 부풀리거나 "불의 기운처럼 서두르는"처럼 기운을 행동에 빗대지 않습니다. 서로 묶이는·부딪치는 관계는 두 글자 사이의 관계로만 풀고, 부모·친구·인연 같은 특정한 사람과의 관계로 바꾸지 않습니다.',
  '11. 한 리포트에서 같은 풀이 말(약속·책임감·기준·여유·차분·서두르다·마무리 등)과 같은 행동 제안(쉬는 시간 넣기, 적어서 비교하기, 미리 나눠 두기 등)은 두 문장까지만 씁니다. "하루 두고 다시 살펴", "쌓아 두지 말고 말로", "한 가지만 정해" 같은 굳은 문구는 쓰지 않습니다.',
  // D-046
  '12. 문장 하나하나가 앞 문장 없이도 읽혀야 합니다. "그래서·이처럼·이때·이 시기·같은 뜻의 글자·앞 시기에 이어"처럼 앞 문장을 가리키는 말로 시작하거나 잇지 않고, 가리키는 것을 직접 씁니다(대운 칸은 "갑자(甲子)의 흐름에서는"처럼 간지 이름으로).',
  '13. 한 칸 안의 문장은 서로 반대되는 말을 하지 않습니다(예: 앞 문장에서 부담이 적다고 했으면 다음 문장에서 부담을 줄이라고 하지 않습니다).',
  '14. 합·충(서로 묶이는·부딪치는 관계)을 인용한 문장은 모습·경향으로만 쓰고 행동 제안으로 끝내지 않습니다. 태어난 달을 "사회 활동"의 자리로 풀지 않습니다. "~을 뜻하는 글자" 앞에는 근거 목록의 다섯 묶음 이름만 씁니다. "제안"처럼 글 밖에서 말하는 표현은 쓰지 않습니다.',
  // D-048: "어우러지는 모습이 보여요"처럼 관계 이름만 바꿔 말하고 끝나는 문장이 나왔다
  '15. 합·충을 말하는 문장은 그 관계가 이 사람에게 어떤 성향·모습으로 나타나는지까지 씁니다. "어우러지는 모습이 보여요"처럼 관계를 다른 말로 바꾸기만 하고 끝내지 않습니다.',
  '',
  PLAIN_WORDS,
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

/** id 목록을 짧게 보여 준다 (없으면 "없음") */
function idList(evidence: readonly Evidence[], pick: (e: Evidence) => boolean): string {
  const ids = evidence.filter(pick).map((e) => e.id);
  return ids.length ? ids.join(', ') : '없음';
}

/**
 * 근거 반복 줄이기 A(D-023): 칸마다 먼저 쓸 근거를 정해 준다.
 * 총평 템플릿이 이미 dayMaster·elements.summary를 쓰므로 다른 칸에서는 되도록 다시 쓰지 않게 한다.
 */
function sectionPriorities(evidence: readonly Evidence[], daewoonIndices: readonly number[]): string[] {
  const daewoonIds = new Set(['daewoon.direction', ...daewoonIndices.map((i) => `daewoon[${i}]`)]);
  return [
    '## 칸별 우선 근거 (같은 근거를 여러 칸에서 되풀이하지 않습니다)',
    '- 총평 템플릿 두 문장이 이미 dayMaster와 elements.summary를 썼습니다. 이 두 근거는 다른 칸에서 다시 쓰지 않거나, 꼭 필요할 때 한 번만 씁니다.',
    `- summary(이어 쓰는 문장): 큰 그림. 십신 그룹·개별 오행 → ${idList(evidence, (e) => e.kind === 'tenGodGroup' || (e.kind === 'elementBalance' && e.id !== 'elements.summary'))}`,
    `- traits: 글자 하나하나의 성향. 원국 글자·개별 십신·합충 → ${idList(evidence, (e) => e.kind === 'pillar' || e.kind === 'tenGod' || e.kind === 'relation')}`,
    `- daewoonNotes: ${idList(evidence, (e) => daewoonIds.has(e.id))}`,
    '- yearly: seun[0]·seun[1]을 중심으로 쓰고, 다른 칸에서 쓴 근거는 한 문장에 한 번까지만 덧붙입니다.',
    '- 한 칸 안에서도 문장마다 되도록 다른 근거를 인용합니다.',
  ];
}

/**
 * 아이 리포트(만 13세 미만, D-044). 사용자 메시지 맨 앞에 넣는다(시스템 프롬프트는 캐시되므로 바꾸지 않는다).
 * 금지 낱말은 forbidden.ts의 CHILD_FORBIDDEN이 검증한다.
 */
// D-048: 아이 안내를 줄였다(6차 측정에서 아이 리포트의 기본 칸 호출이 어른보다 출력 토큰을 2.5배 썼다).
// 금지 낱말은 검증(CHILD_FORBIDDEN 등)이 잡으므로 안내에는 방향만 남긴다
export const CHILD_NOTE = [
  '## 읽는 사람: 아이를 키우는 부모',
  '만 13세 미만 아이의 사주입니다. 문장은 부모가 아이를 지켜보고 돌볼 때 참고할 말로 씁니다(대운 칸 나이 안내가 있으면 그것을 따릅니다).',
  // D-045: 아이 리포트에서 "나를 뺀 5글자", "내 사주에 없던 불"처럼 아이를 "나"로 불렀다
  '- 아이를 "나"로 부르지 않고 "아이"로 부릅니다(아이를 나타내는 글자, 아이의 사주).',
  '- 행동 제안은 부모가 곁에서 해 줄 일로 쓰고, 공부·진로·연애·모임·돈 관리 조언은 쓰지 않습니다.',
].join('\n');

/** 만 5세 이하 아이(D-045): 규칙·책임 글자를 약속·책임이 아니라 일과·순서·습관으로 푼다. 검증: TODDLER_FORBIDDEN */
export const TODDLER_NOTE =
  '- 만 5세 이하: 규칙·책임을 뜻하는 글자는 하루 일과·반복되는 순서·습관으로 풀고, 약속·책임·도리·용돈은 쓰지 않습니다.';

/** 만 6세 이상 아이(D-046): 용돈 이야기는 쓸 수 있다. 5세 이하는 쓰지 않는다(TODDLER_NOTE) */
const ALLOWANCE_NOTE = '- 만 6세 이상이라 용돈을 다루는 모습은 쓸 수 있습니다.';

function childNote(a: Audience): string {
  return a.toddler ? `${CHILD_NOTE}\n${TODDLER_NOTE}` : `${CHILD_NOTE}\n${ALLOWANCE_NOTE}`;
}

/** 아이 리포트의 대운 칸마다 그 10년의 나이에 맞춰 쓰게 한다(D-045) */
function daewoonAudienceLines(a: Audience): string[] {
  return [
    '- daewoonNotes 칸별 나이(그 10년의 만 나이에 맞춰 씁니다):',
    ...a.daewoon.map((d) =>
      d.grown
        ? `  - daewoonIndex ${d.index}: 만 ${d.fromAge}~${d.toAge}세 → 그 나이대(청소년·성인)의 흐름과 제안으로, "아이"·"나" 없이 주어를 빼고 씁니다(사주는 "사주에").`
        : `  - daewoonIndex ${d.index}: 만 ${d.fromAge}~${d.toAge}세 → 부모가 참고할 문장.`,
    ),
  ];
}

/** 주제 이름이 어른 주제여도 아이 리포트에서는 이렇게 바꿔 다룬다 */
// D-046: 아이 리포트의 주제 이름은 topics.ts의 childLabel(물건·돈 습관 / 재능·배움 / 관계)이다
const CHILD_TOPIC_FOCUS: Record<string, string> = {
  wealth: '아이가 물건을 다루고 아끼고 나누는 모습',
  career: '아이가 몰입하고 즐거워하는 놀이·관심사·재능이 드러나는 모습',
  // 합·충 근거를 인용한 문장은 사람 이름을 쓰면 다시 생성된다(relationAsPerson). 그래서 "가족에게"를 지침에 넣지 않는다
  love: '아이가 마음을 표현하고 정을 나누는 모습(합·충을 인용하는 문장에서는 가족·친구 같은 사람을 쓰지 않고 두 글자의 관계로만 풉니다)',
};

export function baseUserMessage(args: {
  evidence: readonly Evidence[];
  templateSummary: readonly ReportSentence[];
  daewoonIndices: readonly number[];
  thisYear: number;
  violations?: readonly Violation[];
  /** 아이 리포트 여부·5세 이하·대운별 나이 (D-044·D-045). 없으면 어른 리포트 */
  audience?: Audience;
  /** 칸별 풀이 각도 안내(D-047, angles.ts의 angleLines) */
  angleBlock?: string;
}): string {
  const L = REPORT_LAYOUT;
  const child = args.audience?.child ?? false;
  const template = args.templateSummary.map((s) => `- ${s.text}`).join('\n');
  return [
    ...(child && args.audience ? [childNote(args.audience), ''] : []),
    evidenceBlock(args.evidence),
    '',
    '## 작성할 칸',
    `- summary: 총평. 아래 두 문장 뒤에 이어질 ${L.summaryAiSentences}문장. 앞 문장을 반복하지 말고, 각 문장은 혼자 읽어도 뜻이 통하게 씁니다(규칙 12).`,
    template,
    `- traits: 타고난 성향 ${L.traitsSentences}문장.`,
    `- daewoonNotes: 대운 흐름. daewoonIndex ${args.daewoonIndices.join(', ')} 순서로 각 ${L.daewoonNoteSentences}문장. 해당 대운 근거(daewoon[n])를 꼭 인용합니다.`,
    // D-046 리뷰: 내년 칸 지시에 숫자 연도를 적으면 모델이 숫자 연도를 쓰도록 이끈다
    `- yearly.thisYear: 올해 흐름 ${L.yearlySentences}문장 (seun[0] 인용).`,
    `- yearly.nextYear: 내년 흐름 ${L.yearlySentences}문장 (seun[1] 인용). 이 칸에서는 그해를 "올해"라고 쓰지 않고 "내년"으로 씁니다(연도를 숫자로 쓰면 그 문장에 seun[1] 근거도 함께 인용합니다).`,
    // D-048: 같은 해(병오년 등)의 첫·마지막 문장이 기운(불)만 보고 써서 사주가 달라도 거의 같았다.
    // 그해 글자가 이 사람에게 갖는 뜻(십신 묶음)과 이 사람 글자와의 관계(같은 글자·합·충)는 사람마다 다르다
    '- yearly 두 칸의 첫 문장과 마지막 문장은 세운 근거에 적힌 그해 글자의 뜻(다섯 묶음 이름)이나 그해 글자와 이 사람 사주 글자의 관계(같은 글자·서로 묶이는 관계·서로 부딪치는 관계)를 근거로 씁니다. 그해의 기운(불·흙 등)만으로 쓰지 않습니다.',
    '- 첫 문장은 그해 간지·기운을 말하고 끝내지 않고, 그 뜻이나 관계가 이 사람의 한 해에 어떻게 나타나는지까지 한 문장 안에 씁니다. 관계를 말하는 문장은 모습·경향으로만 쓰고 행동 제안으로 잇지 않습니다.',
    '- 마지막 문장(행동 제안)은 그해 글자의 뜻(다섯 묶음 이름)에 맞춘 제안으로 씁니다.',
    // D-048: "올해 불의 기운은 내 사주 8글자 중 3개"처럼 그해 기운을 이 사람 사주의 개수로 말했다(그해 글자는 원국 글자가 아니다)
    '- 그해의 기운을 주어로 두고 이 사람 사주의 개수를 말하지 않습니다. 그해 글자는 이 사람 사주 글자에 들어 있지 않습니다. 둘을 견줄 때는 그해 이야기와 사주 이야기를 쉼표로 나눠 씁니다.',
    ...(child && args.audience ? daewoonAudienceLines(args.audience) : []),
    '',
    ...(args.angleBlock ? [args.angleBlock, ''] : []),
    ...sectionPriorities(args.evidence, args.daewoonIndices),
  ].join('\n') + retryNote(args.violations ?? []);
}

export function topicUserMessage(args: {
  topic: TopicConfig;
  evidence: readonly Evidence[];
  violations?: readonly Violation[];
  /** 아이 리포트 여부·5세 이하 (D-044·D-045). 없으면 어른 리포트 */
  audience?: Audience;
  /** 이 리포트의 다른 칸에서 이미 두 번 쓴 풀이 말 (반복을 줄이려 다시 만들 때, D-045) */
  avoidWords?: readonly string[];
  /** 이 칸의 풀이 각도 안내(D-047) */
  angleBlock?: string;
}): string {
  const child = args.audience?.child ?? false;
  const focus = CHILD_TOPIC_FOCUS[args.topic.id] ?? '아이가 일상에서 보이는 모습';
  return [
    ...(child && args.audience ? [childNote(args.audience), ''] : []),
    evidenceBlock(args.evidence),
    '',
    `## 작성할 칸: ${child ? args.topic.childLabel : args.topic.label} 풀이`,
    `- sentences: ${REPORT_LAYOUT.topicSentences}문장`,
    child
      ? `- 지침: 아이 리포트이므로 어른 대상 지침 대신 "${focus}"을 이 주제의 근거로 풀어 씁니다. 결과를 단정하지 않습니다.`
      : `- 지침: ${args.topic.guidance}`,
    '- 이 주제의 고유 근거(십신 그룹·위치·합충)를 먼저 쓰고, 대운·세운 근거는 시기를 말할 때만 씁니다. 문장마다 되도록 다른 근거를 인용합니다.',
    '- 지침과 근거에 나온 전문 용어도 문장에서는 "쉬운 말"로 바꿔 씁니다.',
    // D-049: 2살 아이의 주제 칸에서 10세부터의 흐름을 "마음이 격해질 때"로 풀었다(나이를 모르고 썼다)
    ...(child && args.audience?.daewoon.length
      ? [`- 대운 근거를 인용하면 그 10년의 아이 나이에 맞춰 씁니다(${args.audience.daewoon.map((d) => `daewoon[${d.index}] 만 ${d.fromAge}~${d.toAge}세`).join(', ')}). 근거에 없는 감정·성격 변화로 풀지 않습니다.`]
      : []),
    ...(args.avoidWords?.length ? [`- 이 리포트의 다른 칸에서 이미 두 번 쓴 말이라 이 칸에서는 쓰지 않습니다: ${args.avoidWords.join(', ')}`] : []),
    ...(args.angleBlock ? ['', args.angleBlock] : []),
  ].join('\n') + retryNote(args.violations ?? []);
}

// ---- 월별·10년 흐름(D-052) ----

/** 월별·10년 흐름 칸에 공통으로 붙이는 규칙 */
function periodRules(kind: 'month' | 'year' | 'child'): string[] {
  const unit = kind === 'month' ? '달' : kind === 'year' ? '해' : '칸';
  return [
    `- ${unit}마다 그 ${unit}의 근거를 꼭 인용합니다. 첫 문장은 그 ${unit} 글자의 뜻 묶음이나 원국 글자와의 관계(근거의 "주된 관계"를 먼저)가 이 사람에게 어떻게 나타나는지 씁니다. 관계를 말한 문장은 모습·경향으로만 쓰고 행동 제안으로 끝내지 않습니다.`,
    `- 둘째 문장은 그 뜻에 맞춘 생활 제안입니다. 같은 행동 제안은 두 ${unit}까지만 쓰고, ${unit}마다 첫머리를 다르게 시작합니다.`,
    '- 근거에 없는 구체 장면(모임·회식·여행·휴가·출장·면접·입사·계약·대출·이사·결혼식 같은 일정)을 지어내지 않습니다. 장면 없이 그 뜻에 맞춘 마음가짐·생활 습관으로 씁니다.',
    '- 달·해 이름, 날짜, 나이는 근거에 적힌 표기 그대로 씁니다.',
    // D-052 3단계: 실측에서 같은 글귀·"곁에서"가 칸마다 되풀이됐다
    `- 다른 ${unit}에 쓴 글귀(다섯 어절 안팎)를 되풀이하지 않습니다. "곁에서"는 이 칸 전체에서 한 번만 씁니다.`,
    '- 다른 달·해와 견주는 시간 서술(처음 들어오는, 처음으로, 비로소, 새로 들어오는, 다시 돌아오는)을 쓰지 않습니다.',
  ];
}

/**
 * 어른 월별·10년 흐름(D-052 3단계 C안): 화면에 코드가 그 칸의 사실 줄(간지·윗글자와 아랫글자의 뜻·주된 관계)을 먼저 보여 주고,
 * AI는 칸마다 한 문장만 쓴다
 */
function adultPeriodRules(unit: '달' | '해'): string[] {
  return [
    `- 화면에는 ${unit}마다 코드가 쓴 사실 줄(간지, 윗글자·아랫글자의 뜻, 원국 글자와의 주된 관계)이 먼저 나옵니다. 문장은 그 사실을 되풀이하지 않습니다.`,
    `- 칸마다 한 문장: 그 ${unit}의 근거를 인용하고, 그 ${unit} 사실 줄의 내용(그 ${unit} 글자의 뜻 묶음 또는 원국 글자와의 관계) 중 하나를 꼭 담아, 그것이 이 사람에게 무엇을 뜻하는지와 생활 제안 하나를 한 문장에 씁니다.`,
    '- 원국 글자와의 관계(같은 글자·묶이는·부딪치는 관계)를 담은 문장은 모습·경향으로 끝내고 행동 제안으로 끝내지 않습니다. 제안은 그 글자의 뜻 묶음을 담은 문장에서 합니다.',
    `- 원국의 뜻 묶음 개수("나를 뺀 7글자 중 ○○을 뜻하는 글자가 N개")로 시작하는 문장은 세 ${unit}까지만 씁니다.`,
    `- ${unit} 이름(○○○○년 ○월, ○○○○년, 이${unit}, 간지)으로 문장을 시작하지 않습니다. 문장 첫머리 틀은 같은 것을 세 문장까지만 씁니다.`,
    '- 근거에 없는 구체 장면(모임·회식·여행·휴가·출장·면접·입사·계약·대출·이사·결혼식 같은 일정)을 지어내지 않습니다.',
    `- 다른 ${unit}과 견주는 시간 서술(처음 들어오는, 처음으로, 비로소, 새로 들어오는, 다시 돌아오는)을 쓰지 않습니다. 앞뒤 ${unit}의 사실은 이 칸 근거에 없습니다.`,
    '- 날짜·나이는 근거에 적힌 표기 그대로 씁니다.',
    `- 다른 ${unit}에 쓴 글귀(다섯 어절 안팎)를 되풀이하지 않습니다. "곁에서"는 이 칸 전체에서 한 번만 씁니다.`,
  ];
}

/** 어른 월별 흐름: 절기 달 12칸 × 2문장 */
export function monthlyUserMessage(args: {
  evidence: readonly Evidence[];
  monthCount: number;
  violations?: readonly Violation[];
  angleBlock?: string;
}): string {
  return [
    evidenceBlock(args.evidence),
    '',
    '## 작성할 칸: 월별 흐름',
    `- periods: index 0부터 ${args.monthCount - 1}까지 차례로 ${args.monthCount}칸, 칸마다 ${REPORT_LAYOUT.monthSentences}문장. index i는 month[i] 근거의 절기 달입니다.`,
    ...adultPeriodRules('달'),
    ...(args.angleBlock ? ['', args.angleBlock] : []),
  ].join('\n') + retryNote(args.violations ?? []);
}

/** 10년 흐름의 첫머리 규칙(D-052 3단계): 실측에서 10문장이 모두 "○○○○년은 ○○의 해로, …"로 시작했다 */
const DECADE_OPENER_RULE = '- 문장 첫머리 틀(연도·간지·나이를 빼고 본 앞 세 어절, 예: "○○○○년은 ○○의 해로")은 같은 틀을 세 문장까지만 씁니다. 그해 글자의 뜻, 관계, 나이, 큰 흐름 중 하나로 다르게 시작합니다.';
/** 10년 흐름의 올해·내년(D-052 3단계): 화면에서 올해·내년 칸을 가리키는 사실 줄로 보여 준다 */
const DECADE_SKIP_NOTE = '- 올해와 내년은 위 올해·내년 칸에서 따로 풀기 때문에 이 칸에서는 쓰지 않습니다.';

/** 어른 10년 흐름: 올해·내년을 뺀 해(year[2]~) × 2문장 */
export function decadeUserMessage(args: {
  evidence: readonly Evidence[];
  /** 쓸 해의 index(year[i]) */
  indices: readonly number[];
  violations?: readonly Violation[];
  angleBlock?: string;
}): string {
  return [
    evidenceBlock(args.evidence),
    '',
    '## 작성할 칸: 10년 흐름',
    `- periods: index ${args.indices.join(', ')} 차례로 ${args.indices.length}칸, 칸마다 ${REPORT_LAYOUT.yearSentences}문장. index i는 year[i] 근거의 해입니다.`,
    DECADE_SKIP_NOTE,
    '- 근거에 큰 흐름(대운)이 바뀐다고 적힌 해는 그 전환을 한 문장에 씁니다.',
    ...adultPeriodRules('해'),
    ...(args.angleBlock ? ['', args.angleBlock] : []),
  ].join('\n') + retryNote(args.violations ?? []);
}

/** 아이 부모 관점 요약: 절기 달 3개씩 4묶음 × 2문장 + 해 10칸 × 1문장 */
export function childPeriodUserMessage(args: {
  evidence: readonly Evidence[];
  audience: Audience;
  seasons: readonly { index: number; monthIndices: readonly number[]; name: string }[];
  /** 쓸 해(올해·내년을 뺀 year[2]~) */
  years: readonly { index: number; ageAfterBirthday: number }[];
  violations?: readonly Violation[];
  angleBlock?: string;
}): string {
  return [
    childNote(args.audience),
    '',
    evidenceBlock(args.evidence),
    '',
    '## 작성할 칸: 계절별 흐름과 10년 흐름(부모가 읽는 요약)',
    `- seasons: index 0부터 ${args.seasons.length - 1}까지 차례로, 묶음마다 ${REPORT_LAYOUT.seasonSentences}문장. 문장마다 그 묶음 달 근거 중 하나 이상을 인용합니다. 그 계절에 아이에게 보일 수 있는 모습과 부모가 챙길 일로 씁니다.`,
    ...args.seasons.map((g) => `  - 묶음 ${g.index}(${g.name}): ${g.monthIndices.map((i) => `month[${i}]`).join(', ')}`),
    `- years: index ${args.years.map((y) => y.index).join(', ')} 차례로, 해마다 ${REPORT_LAYOUT.childYearSentences}문장. index i는 year[i] 근거의 해이고, 그해 아이 나이(근거의 만 나이)에 맞춰 씁니다.`,
    DECADE_SKIP_NOTE,
    DECADE_OPENER_RULE,
    ...args.years.filter((y) => y.ageAfterBirthday >= 13).map((y) => `  - year[${y.index}]: 만 ${y.ageAfterBirthday}세가 되는 해 → 부모가 해 줄 일이 아니라 그 나이대 문장으로, "아이"·"나" 없이 씁니다.`),
    ...periodRules('child'),
    ...(args.angleBlock ? ['', args.angleBlock] : []),
  ].join('\n') + retryNote(args.violations ?? []);
}
