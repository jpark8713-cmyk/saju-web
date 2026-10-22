// 풀이 문장 검증 (SPEC 1-0장, Phase 2)
// - 모든 문장은 근거 id를 1개 이상 가져야 하고, 그 id는 이번 호출에 넘긴 근거 목록에 있어야 한다
// - 문장에 쓴 간지·십신은 넘긴 근거 전체(근거 외 언급 금지)와, 그 문장이 인용한 근거(내용 일치) 모두에 있어야 한다
// - 금지 표현, 문장 수, 글자 수 상한
// - 전문 용어(일간·천간·십신 이름 등)가 남으면 다시 생성한다(D-042)
import type { ForbiddenRule } from '../config/topics';
import type { Evidence } from '../engine/types';
import { ADVICE_ENDING_RE, MONTH_SOCIAL_RE, RELATION_PERSON_RE, findForbidden } from './forbidden';
import { TEN_GOD_GROUPS } from '../engine/constants';

/** 근거 목록의 묶음 이름(쉬운 말 표기) */
const GROUP_PLAIN_LABELS: readonly string[] = TEN_GOD_GROUPS.map((g) => g.plain);
import { findJargon } from './jargon';
import { allowedTerms, extractTerms } from './terms';
import type { ReportSentence, Violation } from './types';

export interface SentenceRules {
  /** 이번 호출에서 인용할 수 있는 근거 */
  evidence: readonly Evidence[];
  forbidden: readonly ForbiddenRule[];
  maxChars: number;
}

export interface PreparedRules {
  byId: ReadonlyMap<string, Evidence>;
  globalTerms: ReadonlySet<string>;
  forbidden: readonly ForbiddenRule[];
  maxChars: number;
}

export function prepareRules(r: SentenceRules): PreparedRules {
  return {
    byId: new Map(r.evidence.map((e) => [e.id, e])),
    globalTerms: allowedTerms(r.evidence),
    forbidden: r.forbidden,
    maxChars: r.maxChars,
  };
}

/**
 * 한 칸에 문장이 둘 이상인가: 문장 끝 부호(. ! ? 。) 뒤에 공백과 다른 글자가 이어지면 둘 이상으로 본다.
 * 소수점("3.5")처럼 부호 뒤에 공백이 없으면 문장 끝으로 보지 않는다. 마지막 부호 뒤 닫는 따옴표·괄호는 허용한다.
 */
export function hasMultipleSentences(text: string): boolean {
  return /[.!?。](?:["'”’)\]])?\s+\S/u.test(text.trim());
}

export function validateSentence(s: ReportSentence, path: string, rules: PreparedRules): Violation[] {
  const out: Violation[] = [];
  const text = s.text.trim();
  if (!text) out.push({ code: 'emptyText', path, detail: '빈 문장' });
  if ([...text].length > rules.maxChars) {
    out.push({ code: 'tooLong', path, detail: `${[...text].length}자 (상한 ${rules.maxChars}자)` });
  }
  if (hasMultipleSentences(text)) {
    out.push({ code: 'multipleSentences', path, detail: '한 칸에 문장이 2개 이상 (문장 하나만 쓴다)' });
  }
  if (s.evidenceIds.length === 0) out.push({ code: 'noEvidence', path, detail: '근거 id 없음' });
  const unknown = s.evidenceIds.filter((id) => !rules.byId.has(id));
  if (unknown.length) out.push({ code: 'unknownEvidence', path, detail: `없는 근거 id: ${unknown.join(', ')}` });

  const terms = extractTerms(text);
  const outside = terms.filter((t) => !rules.globalTerms.has(t));
  if (outside.length) out.push({ code: 'termNotInEvidence', path, detail: `근거 목록에 없는 표기: ${outside.join(', ')}` });
  const cited = s.evidenceIds.map((id) => rules.byId.get(id)).filter((e): e is Evidence => !!e);
  const citedTerms = allowedTerms(cited);
  const notCited = terms.filter((t) => rules.globalTerms.has(t) && !citedTerms.has(t));
  if (notCited.length) {
    out.push({ code: 'termNotInCitedEvidence', path, detail: `인용한 근거에 없는 표기: ${notCited.join(', ')}` });
  }
  const jargon = findJargon(text);
  if (jargon.length) {
    out.push({ code: 'jargon', path, detail: `전문 용어를 쉬운 말로 바꿔 씁니다: ${jargon.join(', ')}` });
  }
  for (const f of findForbidden(text, rules.forbidden)) {
    // 걸린 낱말을 알려 줘야 다시 쓸 때 같은 낱말을 피한다(D-044 리뷰). 낱말 몇 글자만 담고 문장 원문은 담지 않는다
    const word = new RegExp(f.pattern, 'u').exec(text)?.[0];
    out.push({ code: 'forbidden', path, detail: `금지 표현(${f.reason})${word ? `: "${word}"` : ''}` });
  }
  if (cited.some((e) => e.kind === 'relation') && RELATION_PERSON_RE.test(text)) {
    const word = RELATION_PERSON_RE.exec(text)?.[0];
    out.push({ code: 'relationAsPerson', path, detail: `합·충은 두 글자 사이의 관계로만 풉니다. 사람과의 관계로 바꾸지 않습니다: "${word}"` });
  }
  // D-046: 합·충은 모습·경향으로만 풀고 행동 제안으로 잇지 않는다
  if (cited.some((e) => e.kind === 'relation') && ADVICE_ENDING_RE.test(text)) {
    out.push({ code: 'relationAsAdvice', path, detail: '합·충(묶이는·부딪치는 관계)을 인용한 문장은 모습·경향으로만 쓰고 "~해 보세요" 같은 행동 제안으로 끝내지 않습니다. 행동 제안은 다른 근거를 인용한 문장에 씁니다' });
  }
  // D-046: 태어난 달 근거 + "사회 활동"은 근거에 없는 자리 의미 풀이다
  if (s.evidenceIds.some((id) => /^(pillar|tenGod)\.month\./u.test(id)) && MONTH_SOCIAL_RE.test(text)) {
    out.push({ code: 'positionMeaning', path, detail: '태어난 달을 "사회 활동"의 자리로 풀지 않습니다. 근거의 글자와 뜻(표현·재능 등)만으로 씁니다' });
  }
  // D-046: 묶음 이름은 근거 목록의 다섯 이름만("하루 일과와 반복되는 순서를 뜻하는 글자" 같은 새 이름 금지)
  // 따옴표는 떼고 본다. "불의 기운을 뜻하는 글자"처럼 오행 이름은 허용한다(리뷰 반영)
  const labelText = text.replace(/\s*·\s*/gu, '·').replace(/['"‘’“”]/gu, '');
  for (const m of labelText.matchAll(/(\S+)(?:을|를) 뜻하는 (?:글자|기운)/gu)) {
    if (!GROUP_PLAIN_LABELS.some((l) => m[1]!.endsWith(l)) && !/^(나무|불|흙|쇠|물)(의|과|와)?$|기운$/u.test(m[1]!)) {
      out.push({ code: 'groupLabel', path, detail: `"~을 뜻하는 글자" 앞에는 근거 목록의 묶음 이름(${GROUP_PLAIN_LABELS.join(', ')})만 씁니다. 풀이는 그 뒤에 이어 씁니다: "${m[0]}"` });
    }
  }
  // D-048: "불의 기운을 뜻하는 재물·활동 글자"처럼 묶음 이름을 "뜻하는"과 "글자" 사이에 끼워 넣는 꼴(위 검사를 비켜 갔다)
  const inner = GROUP_INNER_RE.exec(labelText);
  if (inner) {
    out.push({ code: 'groupLabel', path, detail: `묶음 이름은 "재물·활동을 뜻하는 글자"처럼 "~을 뜻하는 글자" 앞에만 씁니다. 기운 이름과 묶음 이름을 한 꾸밈말에 섞지 않습니다: "${inner[0]}"` });
  }
  // D-048: 그해 기운을 주어로 두고 이 사람 사주의 개수를 말하면 그해 글자가 원국에 있다는 틀린 말이 된다
  const mix = YEAR_NATAL_MIX_RE.exec(text);
  if (mix) {
    out.push({ code: 'yearNatalMix', path, detail: `그해의 기운을 주어로 두고 사주 글자 수를 말하지 않습니다(그해 글자는 사주 글자에 들어 있지 않습니다). 그해 이야기와 사주 이야기를 쉼표로 나눠 씁니다: "${mix[0]}"` });
  }
  out.push(...validateCountBase(text, path, cited));
  out.push(...validateNumbers(text, path, cited));
  return out;
}

/**
 * 묶음 근거의 개수 기준(D-049): 십신 묶음은 나를 나타내는 글자를 뺀 글자 수(8글자 사주면 7글자)에서 센다.
 * 묶음 근거만 인용하고 "내 사주 8글자 중 2개"처럼 원국 전체 글자 수를 기준으로 쓰면 틀린 말이다.
 * 오행 개수 근거(elements.*)를 함께 인용한 문장은 그 기준이 맞을 수 있어 보지 않는다. 숫자 검사는 근거 문구에 두 수가 다 있어 통과시켰다
 */
export function validateCountBase(text: string, path: string, cited: readonly Evidence[]): Violation[] {
  const groups = cited.filter((e) => e.kind === 'tenGodGroup');
  if (!groups.length || cited.some((e) => e.kind === 'elementBalance')) return [];
  const total = /원국 (\d+)글자/u.exec(groups[0]!.content)?.[1];
  // 리뷰 반영: "8글자 중 N개" 꼴(개수를 그 기준으로 셀 때)만 잡는다. "사주 8글자가 고르게"는 개수 기준이 아니다
  if (!total || !new RegExp(`(?<!\\d)${total}\\s?글자\\s?(?:중|가운데|에서)\\s?[^,.]{0,20}?\\d+\\s?개`, 'u').test(text)) return [];
  return [{
    code: 'countBase',
    path,
    detail: `뜻 묶음(~을 뜻하는 글자)의 개수는 나를 나타내는 글자를 뺀 ${Number(total) - 1}글자에서 셉니다. "${total}글자 중"이라고 쓰지 않습니다`,
  }];
}

const GROUP_INNER_RE = new RegExp(`뜻하는 (?:\\S+ )?(?:${GROUP_PLAIN_LABELS.join('|')}) ?(?:글자|기운)`, 'u');
/** "올해 불의 기운은 내 사주 8글자 중 3개", "2027년 흙의 기운이 아이의 사주 6글자 중 3개로" */
const YEAR_NATAL_MIX_RE =
  // 개수까지 와야 잡는다. "올해 불의 기운이 내 사주에 없던 기운이라", "내년 물의 기운이 사주 8글자에 새 흐름을"은 맞는 말이다(리뷰 반영)
  /(?:올해|내년|그해|\d{4}년)(?:의|은|는|에는|엔|에)?\s?(?:나무|불|흙|쇠|물)(?:의)?\s?(?:기운)?(?:은|는|이|가)\s?(?:(?:내|아이의|이 사람의)\s?)?(?:(?:(?:사주|원국)\s?)?\d+\s?글자\s?(?:중|가운데)|(?:사주|원국)(?:에서|에|의)\s?\d+\s?개)/u;

/**
 * 한 리포트에서 되풀이되기 쉬운 풀이 말(D-045). 문장마다 한 번만 세고, 3문장 이상이면 위반이다.
 * 일반 낱말(마음·모습 등)은 셀 수 없어 측정에서 실제로 되풀이된 말만 둔다.
 */
export const REPEAT_WATCH: readonly { word: string; re: RegExp }[] = [
  '약속', '책임감', '부담', '고집', '기준', '우선순위', '마무리', '서두르', '들뜨|들뜬', '여유', '차분', '속도', '호기심', '안정감', '무겁',
  // D-046: 리포트마다 되풀이된 행동 제안(어간 기준 겹침 측정)
  '쉬는 시간', '적어 비교|비교해 보', '미리 나눠|나눠 두|나누어 두', '재주를',
].map((w) => ({ word: w.split('|')[0]!, re: new RegExp(w, 'u') }));

/**
 * 앞 문장에 기대는 표현(D-046). 문장은 근거 목록의 "이 사실을 쓴 문장" 줄에서도 혼자 보이므로 혼자 읽혀야 한다.
 * 처음에는 반복 검사처럼 마지막 시도에서는 봐주는 검사(softValidate)로 쓴다.
 */
// 접속 말은 바로 뒤가 낱말 경계, 가리키는 말(이 시기 등)은 조사가 붙어도 잡는다("이런저런"은 잡지 않는다)
const DEPENDENT_START_RE = new RegExp(
  '^(?:(그래서|그러니|그러므로|따라서|그런데|하지만|그리고|또한|게다가|다만|이처럼|이렇게|그만큼|이 때문에|그 때문에|이런|그런|이러한|그러한)(?![가-힣])' +
    '|(이때|그때|이 시기|그 시기|이 흐름|그 흐름|이 글자|그 글자)(?:에는|에도|부터|만큼|에|엔|은|는|이|가|을|를|의|도)?(?![가-힣]))',
  'u',
);
const DEPENDENT_INNER_RE = /(같은 뜻의 글자|도 같은 뜻|앞 시기에 이어|앞선 흐름에 이어|앞에서 말한|위에서 말한)/u;

export function validateStandalone(sentences: readonly { path: string; text: string }[]): Violation[] {
  return sentences.flatMap((s) => {
    const m = DEPENDENT_START_RE.exec(s.text) ?? DEPENDENT_INNER_RE.exec(s.text);
    return m
      ? [{ code: 'dependentSentence' as const, path: s.path, detail: `문장은 앞 문장 없이도 읽혀야 합니다. "${m[0]}" 대신 무엇을 가리키는지 직접 씁니다(대운 칸은 "갑자(甲子)의 흐름에서는"처럼 간지 이름으로)` }]
      : [];
  });
}

/**
 * 근거에 없는 구체 사례(D-047, 사업자 승인 좁은 목록). 표의 "쓸 수 있는 장면" 안에서만 고르게 한다.
 * 처음에는 마지막 시도에서 봐주는 검사(softValidate)로 쓴다.
 */
// D-049(사업자 결정): 낱말이 아니라 뜻 묶음으로 넓혔다 — 오래된 인연(오래 알던·사귄 사람·친구·관계, 옛 인연), 익숙한 환경(일터·직장·동네·장소),
// 생활 공간(집이나 일터·작업 공간·생활 공간), 앞 시기에 이어
const CONCRETE_CASE_RE = new RegExp(
  [
    '오래(?:된| 알던| 알고 지낸| 사귄| 이어 온| 함께한)? ?(?:인연|친구|지인|동료)',
    '오래(?:된| 알던| 알고 지낸| 사귄| 이어 온| 함께한) ?(?:사람|관계|사이)',
    '옛 ?(?:인연|친구|동료)',
    '익숙한 ?(?:환경|일터|직장|동네|장소|사람들?|얼굴)',
    '집이나 일터', '작업 ?공간', '생활 ?공간', '앞 시기에 이어',
  ].join('|'),
  'u',
);

export function validateConcreteCase(sentences: readonly { path: string; text: string }[]): Violation[] {
  return sentences.flatMap((s) => {
    const m = CONCRETE_CASE_RE.exec(s.text);
    return m
      ? [{ code: 'concreteCase' as const, path: s.path, detail: `근거에 없는 구체 사례("${m[0]}")는 쓰지 않습니다. 칸별 풀이 각도의 장면 안에서 고릅니다` }]
      : [];
  });
}

/**
 * 한 문장에 오행 표와 묶음 표의 각도를 섞지 않는다(D-047). 두 표의 각도 이름에서 일반 낱말과 덜 겹치는 말만 골라 본다.
 * 마지막 시도에서는 봐주는 검사(softValidate)다.
 */
// 리뷰 반영: 흔한 말(헤아리다·가라앉다·정돈·조율·어울림·드러냄 등)은 빼고 각도 이름에만 나오는 말로 좁혔다
// D-048: 늘린 각도(기운·묶음마다 6가지)의 낱말도 넣었다
const ELEMENT_ANGLE_WORDS = /(터전|자리 잡|버팀|품음|쌓아 둠|덜어 냄|맺음|끝맺|굳힘|궁리|스며들|때 고르|싹틈|첫걸음|뻗어 감|곧게 섬|방향 잡|달아오|환히 비|싱그러|휘어|온기|번져|너그러|갈무리|선을? 긋|곧은 말|바른 소리|막힘|속 깊)/u;
const GROUP_ANGLE_WORDS = /(스스로 해내|내 몫|견주며|자기 속도|손으로 만들|일로 잇|직접 움직|틀과 기준|맡은 몫|꾸준한 순서|기댈 곳|채워 두|물건 다루|나란히 걷|내 뜻|새롭게 꾸미|파고들|부지런히 굴리|쓸 곳|이름 걸|삼가|차근차근 익|물려받)/u;

export function validateAngleMix(sentences: readonly { path: string; text: string }[]): Violation[] {
  return sentences.flatMap((s) => {
    const a = ELEMENT_ANGLE_WORDS.exec(s.text);
    const b = GROUP_ANGLE_WORDS.exec(s.text);
    return a && b
      ? [{ code: 'angleMix' as const, path: s.path, detail: `한 문장에 오행 표 각도("${a[0]}")와 묶음 표 각도("${b[0]}")를 함께 쓰지 않습니다. 한쪽만 씁니다` }]
      : [];
  });
}

/**
 * 관계 이름만 바꿔 말하고 끝나는 문장(D-048): "서로 어우러지는 모습이 보여요."
 * 마지막 시도에서는 봐주는 검사(softValidate)다.
 */
const VACUOUS_RELATION_RE =
  /(?:어우러지|어울리|묶이|부딪치|맞물리|이어지|만나)는 (?:모습|흐름|관계|기운)(?:이|을)? ?(?:보여요|보입니다|보이는 편이에요|보일 수 있어요|나타나요|있어요)\.?$/u;

export function validateVacuous(sentences: readonly { path: string; text: string }[]): Violation[] {
  return sentences.flatMap((s) => {
    const text = s.text.trim();
    // D-049: 합·충 문장이 각도 이름 + "~모습이 보여요/나타나요"로 끝나는 꼴도 같은 문제다(7차 4문장)
    const m = VACUOUS_RELATION_RE.exec(text) ?? (/(묶이|부딪)/u.test(text) && ANGLE_COPY_RE.test(text) ? RELATION_THIN_END_RE.exec(text) : null);
    return m
      ? [{ code: 'vacuousRelation' as const, path: s.path, detail: `관계를 다른 말로 바꾸기만 하고 끝내지 않습니다("${m[0]}"). 그 관계가 어떤 성향·모습으로 나타나는지까지 씁니다` }]
      : [];
  });
}

/**
 * 각도 이름 옮겨 쓰기(D-049, 사업자 결정): 칸별 풀이 각도의 이름 낱말이 문장에 그대로 있으면 다시 쓰게 한다(마지막 시도에서는 봐준다).
 * 같은 각도를 받은 리포트끼리 같은 말이 나와 겹쳤다(7차: "이름을 걸고" 4건, "팽팽한 긴장" 3건).
 * 각도 이름(angleTable.ts)마다 그 이름을 이루는 낱말 꼴을 적었다. 조사가 붙거나 띄어 써도 잡는다
 */
// 리뷰 반영: 각도 이름 낱말 전체로 잡으니 7차 190문장 중 81문장(20칸 전부)이 걸려 거의 모든 칸이 다시 쓰였다.
// 일상어(온기·터전·첫걸음·궁리 등)는 빼고, 각도 이름에서만 나오는 여러 낱말 구절로 좁혔다(7차에 리포트끼리 겹친 구절 포함)
export const ANGLE_COPY_RE = new RegExp(
  [
    // 묶음 표
    '스스로 해내', '내 몫(?:을|이)? ?지키', '견주며 힘', '자기 속도', '나란히 걷', '내 뜻(?:을)? ?세우', '손으로 (?:직접 )?만들', '재능을 일로',
    '새롭게 꾸미', '부지런히 굴리', '쓸 곳(?:을)? ?가리', '틀과 기준', '맡은 몫', '이름(?:을)? ?걸고', '물려받은 것',
    // 오행 표
    '휘어 감', '환히 비추', '번져 가', '덜어 냄', '곧은 말', '바른 소리', '막힘(?:을)? ?풀',
    // 관계 표
    '어울려 하나', '새 힘(?:을)? ?내', '누그러져 부드러워', '한데 모여', '부딪치며 바뀌', '흔들어 깨우', '엇갈리며 새', '팽팽한 긴장',
  ].join('|'),
  'u',
);

export function validateAngleCopy(sentences: readonly { path: string; text: string }[]): Violation[] {
  return sentences.flatMap((s) => {
    const m = ANGLE_COPY_RE.exec(s.text);
    return m
      ? [{ code: 'angleCopy' as const, path: s.path, detail: `풀이 각도 이름의 낱말("${m[0]}")을 그대로 옮기지 않습니다. 각도가 가리키는 쪽을 이 사람의 글자·개수와 엮어 다른 말로 씁니다` }]
      : [];
  });
}

/**
 * 한 문장에 개수 기준을 두 번 쓰기(D-051): "내 사주 8글자 중 표현·재능을 뜻하는 글자가 나를 뺀 7글자 중 3개".
 * 기준 글자 수가 서로 다른 "N글자 중"이 두 번 나오면 잡는다. 칸마다 한 번만 다시 쓰게 한다(첫 시도에서만 본다)
 */
export function validateDoubleBase(sentences: readonly { path: string; text: string }[]): Violation[] {
  return sentences.flatMap((s) => {
    const bases = new Set([...s.text.matchAll(/(?<!\d)(\d+)\s?글자\s?(?:중|가운데)/gu)].map((m) => m[1]));
    return bases.size >= 2
      ? [{ code: 'doubleBase' as const, path: s.path, detail: '한 문장에 개수 기준을 두 번 쓰지 않습니다. 뜻 묶음은 "나를 뺀 N글자 중", 기운은 "내 사주 N글자 중" 하나만 씁니다' }]
      : [];
  });
}

/** 합·충 문장이 각도 이름을 붙이고 "~모습이 보여요/나타나요"로 끝나는 꼴(D-049) */
const RELATION_THIN_END_RE = /(?:모습|흐름|기운|경향|긴장)(?:이|을)? ?(?:보여요|보입니다|나타나요|나타날 수 있어요|보일 수 있어요|도는 모습이 보여요)\.?$/u;

/** 한 문장에서 같은 말을 되풀이(D-049): "부딪쳐서 부딪치며", "모여서 모여" */
const REPEATED_STEM_RE = /(?<![가-힣])([가-힣]{2})[가-힣]*(?:서|며|고|니|면)\s+\1/u;

export function validateRepeatedStem(sentences: readonly { path: string; text: string }[]): Violation[] {
  return sentences.flatMap((s) => {
    const m = REPEATED_STEM_RE.exec(s.text);
    return m
      ? [{ code: 'repeatedStem' as const, path: s.path, detail: `한 문장에서 같은 말을 되풀이하지 않습니다("${m[0]}")` }]
      : [];
  });
}

/**
 * 근거에 없는 개수(D-049): "지출 항목을 세 가지로 나눠"처럼 근거에 없는 수를 만들어 넣지 않는다. 한글 수(둘 이상)만 본다.
 * "한 가지·한 번"은 흔한 말이라 보지 않고, 글자·기운 수("두 글자")는 근거 사실이라 보지 않는다. 숫자(3개)는 validateNumbers가 본다.
 * 마지막 시도에서는 봐주는 검사(softValidate)다
 */
const INVENTED_COUNT_RE = /(?<![가-힣])(?:두|세|네|다섯|여섯|일곱|여덟|아홉|열) ?(?:가지|번|곳|군데|개|명|주|달|시간|권|줄)(?!째| ?기운|의 ?글자)/u;

export function validateInventedCount(sentences: readonly { path: string; text: string }[]): Violation[] {
  return sentences.flatMap((s) => {
    const m = INVENTED_COUNT_RE.exec(s.text);
    return m
      ? [{ code: 'inventedCount' as const, path: s.path, detail: `근거에 없는 개수("${m[0]}")를 만들어 넣지 않습니다. 개수 없이 쓰거나 "하나씩"처럼 씁니다` }]
      : [];
  });
}

/** 서로 묶이는·부딪치는 관계, 같은 글자를 말하는 낱말 (올해·내년 칸 검사용) */
export const LUCK_RELATION_WORD_RE = /(묶이|부딪|맞부딪|끌어당|어우러|같은 글자)/u;

/** 올해·내년 칸의 그해 글자 정보: 뜻 묶음(쉬운 이름)과 이 사람 글자와의 관계가 있는지 */
export interface YearFacts {
  seunId: string;
  groupLabels: readonly string[];
  hasRelation: boolean;
}

/**
 * 올해·내년 첫·마지막 문장은 그해 글자의 뜻(묶음 이름)이나 이 사람 글자와의 관계로 쓴다(D-048).
 * 관계를 말한 문장은 행동 제안으로 끝내지 않는다. 마지막 시도에서는 봐주는 검사(softValidate)다.
 */
export function validateYearly(sentences: readonly ReportSentence[], path: string, facts: YearFacts): Violation[] {
  const out: Violation[] = [];
  const squashed = (t: string) => t.replace(/\s*·\s*/gu, '·');
  const ends = sentences.length > 1 ? [0, sentences.length - 1] : [0];
  for (const i of ends) {
    const s = sentences[i];
    if (!s) continue;
    const t = squashed(s.text);
    const meaning = facts.groupLabels.some((l) => t.includes(l));
    const relation = facts.hasRelation && LUCK_RELATION_WORD_RE.test(t);
    if (!s.evidenceIds.includes(facts.seunId) || !(meaning || relation)) {
      out.push({
        code: 'yearlyNotPersonal',
        path: `${path}[${i}]`,
        detail: `첫·마지막 문장은 ${facts.seunId}를 인용하고, 그해 글자의 뜻(${facts.groupLabels.join(', ')})${facts.hasRelation ? '이나 이 사람 사주 글자와의 관계(같은 글자·묶이는·부딪치는 관계)' : ''}를 문장에 씁니다. 그해의 기운만으로 쓰지 않습니다`,
      });
    }
  }
  // D-049: 한 칸 4문장 중 3문장 이상이 같은 뜻 묶음 이름을 쓰면 한쪽으로 쏠린다(7차: 2살 아이 올해 배움·보살핌 3/4)
  for (const label of GROUP_PLAIN_LABELS) {
    const n = sentences.filter((s) => squashed(s.text).includes(label)).length;
    if (n >= 3) {
      out.push({ code: 'yearlyGroupSkew', path, detail: `한 칸에서 "${label}"을 ${n}문장에 썼습니다. 같은 뜻 묶음은 두 문장까지 쓰고, 나머지는 그해 글자의 다른 뜻·관계나 다른 근거로 씁니다` });
    }
  }
  sentences.forEach((s, i) => {
    if (s.evidenceIds.includes(facts.seunId) && facts.hasRelation && LUCK_RELATION_WORD_RE.test(s.text) && ADVICE_ENDING_RE.test(s.text)) {
      out.push({ code: 'relationAsAdvice', path: `${path}[${i}]`, detail: '그해 글자와의 관계(묶이는·부딪치는 관계)를 말한 문장은 모습·경향으로만 쓰고 행동 제안으로 끝내지 않습니다. 행동 제안은 그해 글자의 뜻(묶음 이름)으로 씁니다' });
    }
  });
  return out;
}

/** 풀이 말별로 그 말이 들어간 문장 수 */
export function repeatedWordCounts(texts: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of texts) for (const w of REPEAT_WATCH) if (w.re.test(t)) m.set(w.word, (m.get(w.word) ?? 0) + 1);
  return m;
}

/** fixedTexts(템플릿 등 고칠 수 없는 문장)까지 합쳐 3문장 이상 쓴 말을 sentences 쪽 위반으로 돌려준다 */
export function validateRepetition(
  sentences: readonly { path: string; text: string }[],
  fixedTexts: readonly string[] = [],
  limit = 2,
): Violation[] {
  const counts = repeatedWordCounts([...fixedTexts, ...sentences.map((s) => s.text)]);
  return [...counts].filter(([, n]) => n > limit).map(([word, n]) => {
    const paths = sentences.filter((s) => REPEAT_WATCH.find((w) => w.word === word)!.re.test(s.text)).map((s) => s.path);
    return { code: 'repeatedWord' as const, path: paths.at(-1) ?? '', detail: `"${word}"를 ${n}문장에 썼습니다(총평 템플릿 문장까지 세어 최대 ${limit}문장). ${n - limit}문장 이상을 다른 말로 바꿉니다: ${paths.join(', ')}` };
  });
}

/** 대운 시작 표준 표기 "K세(YYYY년 M월)". 앞이 숫자가 아니어야 한다("18세(…)" 안의 "8세(…)"를 따로 보지 않음) */
const DAEWOON_LABEL_RE = /(?<!\d)\d{1,3}\s?세\s?\(\s?\d{4}\s?년\s?\d{1,2}\s?월\s?\)/gu;
const KOREAN_AGE = '(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스물|서른|마흔|쉰|예순|일흔|여든|아흔)(?:\\s?(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉))?\\s?살';
/**
 * 숫자로 쓴 사실: 연·월(2026년 6월, 2026.6), 연도(2026년, 98년부터), 월(6월), 나이(28세, 28살, 스물여덟 살), n년 n개월.
 * "10년간", "10년에 한 번"처럼 기간을 뜻하는 두 자리 "년"은 사실로 보지 않는다(두 자리 연도는 바로 뒤에 "부터"가 올 때만, 예: 98년부터).
 */
const NUMBER_FACT_RE = new RegExp(
  [
    '\\d{4}\\s?년\\s?\\d{1,2}\\s?월',
    '\\d{4}\\s?\\.\\s?\\d{1,2}(?!\\d)',
    '\\d+\\s?년\\s?\\d+\\s?개월',
    '\\d{4}\\s?년',
    '(?<!\\d)\\d{2}\\s?년(?=\\s?부터)',
    '(?<!\\d)\\d{1,2}\\s?월',
    '(?<!\\d)\\d{1,3}\\s?(?:세|살)',
    KOREAN_AGE,
  ].join('|'),
  'gu',
);
const YEAR_ONLY_RE = /^\d{4}년$/u;
/** 숫자로 쓴 개수: 3개, 7글자 (D-043). "6개월"은 기간이라 뺀다. 생활 조언의 개수는 "세 가지"처럼 한글로 쓰게 한다 */
const COUNT_FACT_RE = /(?<!\d)\d+\s?(?:개(?!월)|글자)/gu;

function squash(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 전각 괄호를 반각으로 맞춘다 */
function normalizeParens(s: string): string {
  return s.replace(/（/g, '(').replace(/）/g, ')');
}

/** 숫자 경계를 지켜 포함 여부를 본다 ("8세"가 "18세" 안에 있다고 보지 않음) */
function containsToken(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!\\d)${escaped}`, 'u').test(haystack);
}

/**
 * 숫자로 쓴 사실은 인용한 근거의 값만 쓴다(D-022).
 * 1) 문장 속 대운 표준 표기 "K세(YYYY년 M월)"는 인용한 대운 근거의 표기와 정확히 같아야 한다. 확인한 표기는 지운다.
 * 2) 남은 숫자 표기 중 인용한 세운의 연도("2026년")는 허용한다.
 * 3) 대운 근거를 인용한 문장이면 그 밖의 나이·연·월은 모두 거부한다(표준 표기로만 쓴다).
 * 4) 대운 근거를 인용하지 않은 문장이면 남은 숫자 표기가 인용한 근거 문구에 있어야 한다.
 * 5) 개수(3개, 7글자)는 대운 인용 여부와 상관없이 인용한 근거 문구에 있어야 한다(D-043).
 */
export function validateNumbers(text: string, path: string, cited: readonly Evidence[]): Violation[] {
  const out: Violation[] = [];
  const normalized = normalizeParens(text);
  const citedAll = squash(normalizeParens(cited.map((e) => e.content).join(' | ')));
  const counts = [...new Set([...normalized.matchAll(COUNT_FACT_RE)].map((m) => squash(m[0])))];
  const wrongCounts = counts.filter((t) => !containsToken(citedAll, t));
  if (wrongCounts.length) {
    out.push({ code: 'numberNotInEvidence', path, detail: `인용한 근거에 없는 개수 표기: ${wrongCounts.join(', ')}` });
  }
  const daewoonCited = cited.filter((e) => e.kind === 'daewoon' || e.kind === 'daewoonDirection');
  const citedLabels = new Set(
    daewoonCited.flatMap((e) => [...normalizeParens(e.content).matchAll(DAEWOON_LABEL_RE)].map((m) => squash(m[0]))),
  );
  const example = [...citedLabels][0] ?? 'K세(YYYY년 M월)';

  const labelsInText = [...normalized.matchAll(DAEWOON_LABEL_RE)].map((m) => squash(m[0]));
  const wrongLabels = labelsInText.filter((l) => !citedLabels.has(l));
  if (wrongLabels.length) {
    out.push({ code: 'numberNotInEvidence', path, detail: `인용한 대운 근거와 다른 시작 표기: ${wrongLabels.join(', ')}` });
  }

  const rest = normalized.replace(DAEWOON_LABEL_RE, ' ');
  const seunYears = new Set(
    cited.filter((e) => e.kind === 'seun').flatMap((e) => [...e.content.matchAll(/\d{4}년/gu)].map((m) => m[0])),
  );
  const tokens = [...rest.matchAll(NUMBER_FACT_RE)]
    .map((m) => squash(m[0]))
    .filter((t) => !(YEAR_ONLY_RE.test(t) && seunYears.has(t)));
  if (!tokens.length) return out;

  if (daewoonCited.length) {
    out.push({
      code: 'daewoonStartFormat',
      path,
      detail: `대운 시작 시점은 근거 표기 그대로 "${example}"처럼 씁니다. 따로 쓴 숫자 표기: ${[...new Set(tokens)].join(', ')}`,
    });
    return out;
  }
  const missing = [...new Set(tokens.filter((t) => !containsToken(citedAll, t)))];
  if (missing.length) {
    out.push({ code: 'numberNotInEvidence', path, detail: `인용한 근거에 없는 숫자 표기: ${missing.join(', ')}` });
  }
  return out;
}

export function validateSection(
  sentences: readonly ReportSentence[],
  path: string,
  expectedCount: number,
  rules: PreparedRules,
): Violation[] {
  const countViolation: Violation[] =
    sentences.length === expectedCount
      ? []
      : [{ code: 'sentenceCount', path, detail: `${sentences.length}문장 (필요 ${expectedCount}문장)` }];
  return [...countViolation, ...sentences.flatMap((s, i) => validateSentence(s, `${path}[${i}]`, rules))];
}
