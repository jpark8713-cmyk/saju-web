// 풀이 문장 검증 (SPEC 1-0장, Phase 2)
// - 모든 문장은 근거 id를 1개 이상 가져야 하고, 그 id는 이번 호출에 넘긴 근거 목록에 있어야 한다
// - 문장에 쓴 간지·십신은 넘긴 근거 전체(근거 외 언급 금지)와, 그 문장이 인용한 근거(내용 일치) 모두에 있어야 한다
// - 금지 표현, 문장 수, 글자 수 상한
import type { ForbiddenRule } from '../config/topics';
import type { Evidence } from '../engine/types';
import { findForbidden } from './forbidden';
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
  for (const f of findForbidden(text, rules.forbidden)) {
    out.push({ code: 'forbidden', path, detail: `금지 표현(${f.reason})` });
  }
  out.push(...validateNumbers(text, path, cited));
  return out;
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
 */
export function validateNumbers(text: string, path: string, cited: readonly Evidence[]): Violation[] {
  const out: Violation[] = [];
  const normalized = normalizeParens(text);
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
  const citedText = squash(normalizeParens(cited.map((e) => e.content).join(' | ')));
  const missing = [...new Set(tokens.filter((t) => !containsToken(citedText, t)))];
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
