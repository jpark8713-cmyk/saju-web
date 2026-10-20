// 풀이 문장에서 간지·십신 표기를 찾는다. 찾은 표기는 인용한 근거의 terms 안에 있어야 한다.
// 한글 간지는 일반 낱말(갑자기, 정해진, 기사, 임신…)과 겹치므로 아래 규칙으로만 찾는다(Docs/decisions.md D-017).
//  1) 한자 천간·지지 글자
//  2) 천간 + 제 오행(갑목·병화·임수…)을 붙여 쓴 낱말. 뒤에 조사가 붙어도 찾고, 낱말 중간(책임수행, 경금속)은 찾지 않는다
//  3) 60갑자 이름 + 긴 접미어(일주·대운·세운 등)
//  4) 60갑자 이름 + 짧은 접미어(년·월·일·시·운·생) + 경계(조사 또는 한글 아님)
//  5) 60갑자 이름 + 조사 + 경계, 또는 띄어 쓴 60갑자 이름 단독("갑자 기운", "일주 정축", "정축, 을묘")
//     단, 일반 낱말과 겹치는 이름(기사·임신·정해 등)은 1)·3)·4)로만 찾는다
//  2)~5)는 모두 앞이 낱말 경계여야 한다 ("안정을 목표"의 "을 목"이 아님)
//  6) 십신·그룹 이름(칠살 = 편관). 앞이 낱말 경계여야 하고, "상관없이"·"인성 교육"처럼 일반 낱말인 경우는 뺀다
//  조사에는 서술격 어미(입니다·이라서·이며·인·답게 등)도 포함한다
import { BRANCHES_HANJA, BRANCHES_KO, STEMS_HANJA, STEMS_KO, TEN_GOD_GROUPS, TEN_GOD_KO } from '../engine/constants';
import type { Evidence } from '../engine/types';

const STEM_ELEMENT_KO = ['목', '목', '화', '화', '토', '토', '금', '금', '수', '수'];
const PILLAR_NAMES_KO = Array.from({ length: 60 }, (_, i) => `${STEMS_KO[i % 10]}${BRANCHES_KO[i % 12]}`);
const HANJA_CHARS = new Set<string>([...STEMS_HANJA, ...BRANCHES_HANJA]);

/** 60갑자 이름과 겹치는 흔한 낱말: 조사만 붙었거나 단독으로 쓴 형태는 간지로 보지 않는다 */
const COMMON_WORD_PILLARS = new Set([
  '기사', '신사', '임신', '임자', '병자', '기미', '정사', '정해', '경신', '정유', '병신', '신축', '기축', '무인',
  '정미', '을사', '임진', '경인',
]);
/** 천간+오행이 들어간 일반 낱말 (조사가 붙어도 일반 뜻인 경우) */
const STEM_ELEMENT_FALSE_FRIENDS = /정화(?=를 위|가 필요|시켜| ?(작업|시간|활동|과정|장치|조|수))/gu;
/** 십신처럼 보이는 일반 낱말 */
const TEN_GOD_FALSE_FRIENDS = /상관\s?(?:없|이\s?없|하지|관계|도\s?없)|상관관계|인성(?= ?(교육|이 (좋|바르|착|따뜻)))/gu;

// 조사와 서술격 어미 (긴 것부터)
const PARTICLE =
  '(?:이기 때문에|이었어요|였어요|이에요|예요|입니다|이라서|이어서|여서|이라|이고|이며|이니|으로서|로서|으로|에서|에게|부터|까지|처럼|보다|답게|' +
  '이|가|은|는|을|를|의|와|과|로|에|엔|도|만|라|고|며|인|라서)';
/** 낱말 뒤 경계: 다음 글자가 한글이 아니다 */
const BOUNDARY = '(?![가-힣])';
/** 낱말 앞 경계: 앞 글자가 한글이 아니다 */
const FRONT = '(?<![가-힣])';
const LONG_SUFFIX = '(?:일주|년주|월주|시주|대운|세운)';
const SHORT_SUFFIX = '(?:년|월|일|시|운|생|해)';

const namesAlt = PILLAR_NAMES_KO.join('|');
const stemElementAlt = STEMS_KO.map((s, i) => `${s}${STEM_ELEMENT_KO[i]}`).join('|');
const pillarLongRe = new RegExp(`${FRONT}(${namesAlt})\\s?${LONG_SUFFIX}`, 'gu');
const pillarShortRe = new RegExp(`${FRONT}(${namesAlt})\\s?${SHORT_SUFFIX}(?:${PARTICLE}){0,2}${BOUNDARY}`, 'gu');
const pillarParticleRe = new RegExp(`${FRONT}(${namesAlt})(?:${PARTICLE}){0,2}${BOUNDARY}`, 'gu');
const stemElementRe = new RegExp(`${FRONT}(${stemElementAlt})(?:${PARTICLE}){0,2}${BOUNDARY}`, 'gu');
// 십신도 앞이 낱말 경계여야 한다 ("고정관념"의 정관, "개인성향"의 인성이 아님)
const tenGodRe = new RegExp(`${FRONT}(${[...Object.values(TEN_GOD_KO), ...TEN_GOD_GROUPS.map((g) => g.ko), '칠살'].join('|')})`, 'gu');

const GROUP_MEMBERS: Record<string, string[]> = Object.fromEntries(
  TEN_GOD_GROUPS.map((g) => [g.ko, g.members.map((m) => TEN_GOD_KO[m])]),
);

/** 문장에서 찾은 표기. 한자는 글자 단위, 천간+오행은 천간 한 글자, 60갑자는 이름 그대로 */
export function extractTerms(text: string): string[] {
  const found = new Set<string>();
  for (const ch of text) if (HANJA_CHARS.has(ch)) found.add(ch);
  for (const m of text.matchAll(pillarLongRe)) found.add(m[1]!);
  for (const m of text.matchAll(pillarShortRe)) found.add(m[1]!);
  for (const m of text.matchAll(pillarParticleRe)) if (!COMMON_WORD_PILLARS.has(m[1]!)) found.add(m[1]!);
  for (const m of text.replace(STEM_ELEMENT_FALSE_FRIENDS, '').matchAll(stemElementRe)) found.add(m[1]!.charAt(0));
  for (const m of text.replace(TEN_GOD_FALSE_FRIENDS, '').matchAll(tenGodRe)) found.add(m[1] === '칠살' ? '편관' : m[1]!);
  return [...found];
}

/** 근거 목록이 허용하는 표기 전체 (한자는 글자 단위로 펼치고, 십신이 있으면 그 그룹 이름도 허용) */
export function allowedTerms(evidence: readonly Evidence[]): Set<string> {
  const out = new Set<string>();
  for (const e of evidence) {
    for (const t of e.terms) {
      out.add(t);
      for (const ch of t) if (HANJA_CHARS.has(ch)) out.add(ch);
      // 간지 두 글자(한글)는 천간 한 글자도 허용 (예: 갑자 → 갑목의 '갑')
      if (PILLAR_NAMES_KO.includes(t)) out.add(t.charAt(0));
    }
  }
  for (const [group, members] of Object.entries(GROUP_MEMBERS)) {
    if (members.some((m) => out.has(m))) out.add(group);
  }
  return out;
}
