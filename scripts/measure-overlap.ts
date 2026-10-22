// 샘플 사이 문구 겹침 측정(D-046): 낱말에서 조사·어미를 떼어 어간 열을 만들고, 네 낱말 안에서 순서가 같은 어간 2~3개 묶음을
// 샘플(리포트) 사이에서 센다. 4어절 일치로 못 잡는 "일정에 쉬는 시간을 넣어 / 일정 사이사이에 쉬는 시간을 미리 넣어"를 잡는다.
// 사용: npx tsx scripts/measure-overlap.ts --tag <측정 폴더> [--min 3] [--yearLast]
// 주문 하나를 만들 때는 다른 주문의 문장을 볼 수 없어서 생성 단계에서는 막지 못한다. 측정 때마다 이 수를 보고해 관리한다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportBody, ReportSentence } from '../src/llm/types';

const OUT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../samples-output');
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const JOSA = /(으로써|으로서|에서는|에게는|에서|에게|부터|까지|처럼|보다|으로|이나|이고|이라|이며|라서|이니|만큼|마다|조차|밖에|은|는|이|가|을|를|과|와|도|의|에|로|만|나|엔)$/u;
const ENDS = ['어 보세요', '아 보세요', '해 보세요', '어 두면', '아 두면', '주세요', '보세요', '두면', '어요', '아요', '해요', '에요', '예요', '어서', '아서', '해서', '으니', '니까', '으면', '니', '면', '고', '게', '는', '은', '을', '기', '어', '아', '며', '지', '요', '던'];
const VERB_MAP: readonly [RegExp, string][] = [
  [/^넣/u, '넣다'], [/^두[고면어었]?$|^둬|^두는|^둔/u, '두다'], [/^쉬/u, '쉬다'], [/^정해|^정하|^정한|^정할/u, '정하다'], [/^적어|^적고|^적는|^적으/u, '적다'],
  [/^나눠|^나누|^나눈/u, '나누다'], [/^살펴|^살피/u, '살피다'], [/^챙기|^챙겨/u, '챙기다'], [/^줄이|^줄여/u, '줄이다'], [/^만들/u, '만들다'], [/^비교/u, '비교하다'],
  [/^정리/u, '정리하다'], [/^움직/u, '움직이다'], [/^기다려|^기다리/u, '기다리다'],
];
const STOP = new Set(['뜻하', '뜻하는', '글자', '태어난', '해', '달', '날', '시', '윗글자', '아랫글자', '기운', '흐름', '큰', '나', '내', '사주', '아이', '수', '볼', '있', '있어', '있는', '편', '편이', '모두', '중', '개', '뺀', '좋', '좋아', '보', '보면', '하', '할', '한', '될', '더', '이', '그', '이번', '올해', '내년', '년', '시기', '때', '것', '일', '정도', '그해', '들어오', '들어와', '들어오는', '함께', '많', '많은', '없', '없어서', '하나도', '같은', '같', '10년', '단위', '이어지', '이어지는', '된', '되', '되는', '마음', '모습', '사람']);
/** 쉬운 말 표기·간지·자리처럼 일부러 같게 쓰는 말만으로 된 묶음은 "구조 문구"로 뺀다 */
const STRUCTURAL = /^(병오|정미|해라|해에|해로|보이|않아서|부딪치|관계라|묶이는|이어|나무|불|흙|쇠|물)$/u;

function stem(w: string): string | null {
  let x = w.replace(/[.,!?"'“”()（）]/gu, '').replace(/\p{Script=Han}/gu, '');
  if (!x || /\d/u.test(x)) return null;
  for (const [re, v] of VERB_MAP) if (re.test(x)) return v;
  x = x.replace(JOSA, '');
  for (const e of ENDS) if (x.length > e.length + 1 && x.endsWith(e)) { x = x.slice(0, -e.length); break; }
  if (x.length < 2 || STOP.has(x) || x.includes('·')) return null;
  return x;
}

function sentencesOf(b: ReportBody, yearLast: boolean): ReportSentence[] {
  if (yearLast) return [b.yearly.thisYear.at(-1)!, b.yearly.nextYear.at(-1)!];
  // 총평 템플릿 두 문장은 코드가 쓰는 고정 문장이라 뺀다
  return [...b.summary.slice(2), ...b.traits, ...Object.values(b.topics).flat(), ...b.daewoonNotes.flatMap((n) => n.sentences), ...b.yearly.thisYear, ...b.yearly.nextYear];
}

function keysOf(st: readonly string[]): Set<string> {
  const W = 4;
  const k = new Set<string>();
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < Math.min(st.length, i + W); j++) {
    if (st[i] !== st[j]) k.add(`${st[i]}+${st[j]}`);
    for (let l = j + 1; l < Math.min(st.length, i + W); l++) k.add(`${st[i]}+${st[j]}+${st[l]}`);
  }
  return k;
}

function main(): void {
  const tag = arg('tag', '');
  if (!/^[A-Za-z0-9_-]+$/u.test(tag)) throw new Error('--tag(측정 폴더 이름)를 지정하세요');
  const min = Number(arg('min', '3'));
  const yearLast = process.argv.includes('--yearLast');
  const d = JSON.parse(readFileSync(join(OUT_ROOT, tag, 'claude-sonnet-5-5.json'), 'utf8')) as { results: { sample: number; ok: boolean; body?: ReportBody }[] };
  const map = new Map<string, { samples: Set<number>; ex: string[] }>();
  for (const r of d.results) {
    if (!r.ok || !r.body) continue;
    for (const s of sentencesOf(r.body, yearLast)) {
      const st = s.text.split(/\s+/u).map(stem).filter((x): x is string => !!x);
      for (const k of keysOf(st)) {
        const e = map.get(k) ?? { samples: new Set<number>(), ex: [] };
        e.samples.add(r.sample);
        if (e.ex.length < 3) e.ex.push(`${r.sample}: ${s.text}`);
        map.set(k, e);
      }
    }
  }
  const hits = [...map].filter(([k, e]) => e.samples.size >= min && !k.split('+').every((w) => STRUCTURAL.test(w)));
  // 3어간 묶음에 들어 있고 샘플 집합이 같은 2어간 묶음은 따로 세지 않는다
  const tri = hits.filter(([k]) => k.split('+').length === 3);
  const pairs = hits.filter(([k, e]) => k.split('+').length === 2 && !tri.some(([t, te]) => k.split('+').every((w) => t.split('+').includes(w)) && te.samples.size === e.samples.size));
  const rows = [...tri, ...pairs].sort((a, b) => b[1].samples.size - a[1].samples.size);
  process.stdout.write(`${JSON.stringify({ tag, scope: yearLast ? 'yearLast' : 'all', min, groups: rows.length })}\n`);
  for (const [k, e] of rows) process.stdout.write(`${e.samples.size}건 [${[...e.samples].join(',')}] ${k}\n${e.ex.map((x) => `    ${x}`).join('\n')}\n`);
}

main();
