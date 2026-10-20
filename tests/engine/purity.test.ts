// 엔진은 순수 함수여야 한다: 네트워크·DB·파일·환경변수·현재 시각에 의존하지 않는다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { solar } from './helpers';

const ENGINE_DIR = join(import.meta.dirname, '../../src/engine');
const ALLOWED_PACKAGES = ['@fullstackfamily/manseryeok', 'lunar-javascript'];
const FORBIDDEN_PATTERNS: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch 호출'],
  [/\bXMLHttpRequest\b/, 'XHR'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bprocess\.env\b/, '환경변수'],
  [/\bDate\.now\s*\(/, '현재 시각'],
  [/new Date\(\s*\)/, '현재 시각'],
  [/\bMath\.random\s*\(/, '난수'],
  [/\bcrypto\b/, '난수·암호(crypto)'],
  [/\bperformance\.now\s*\(/, '현재 시각(performance)'],
  [/\bprocess\.hrtime\b/, '현재 시각(hrtime)'],
  [/\brequire\s*\(/, '동적 require'],
  [/\bimport\s*\(/, '동적 import'],
];

function engineFiles(): string[] {
  return readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.ts')).map((f) => join(ENGINE_DIR, f));
}

describe('엔진 순수성', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('허용된 라이브러리와 엔진 내부 모듈만 import한다', () => {
    const bad = engineFiles().flatMap((file) => {
      const src = readFileSync(file, 'utf8');
      // from 'x' / from "x" 와 부수효과 import 'x' 를 모두 본다
      const fromSpecs = [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      const sideEffectSpecs = [...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
      const specs = [...fromSpecs, ...sideEffectSpecs];
      return specs.filter((s) => !s.startsWith('./') && !ALLOWED_PACKAGES.includes(s)).map((s) => `${file}: ${s}`);
    });
    expect(bad).toEqual([]);
  });

  it('네트워크·환경변수·현재 시각·난수를 쓰지 않는다', () => {
    const bad = engineFiles().flatMap((file) => {
      const src = readFileSync(file, 'utf8');
      return FORBIDDEN_PATTERNS.filter(([re]) => re.test(src)).map(([, why]) => `${file}: ${why}`);
    });
    expect(bad).toEqual([]);
  });

  it('fetch를 막아도 계산된다', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('네트워크 호출 금지');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const chart = buildChart(solar(1990, 5, 15, { hour: 14, minute: 30 }), { referenceYear: 2026 });
    buildEvidence(chart);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('같은 입력이면 같은 SajuChart와 Evidence[]', () => {
    const input = solar(1987, 7, 15, { hour: 10, minute: 20 }, { gender: 'female' });
    const a = buildChart(input, { referenceYear: 2026 });
    const b = buildChart(structuredClone(input), { referenceYear: 2026 });
    expect(b).toEqual(a);
    expect(buildEvidence(b)).toEqual(buildEvidence(a));
  });

  it('입력 객체를 변경하지 않는다', () => {
    const input = Object.freeze(solar(2000, 1, 1, Object.freeze({ hour: 9, minute: 0 })));
    expect(() => buildChart(input, { referenceYear: 2026 })).not.toThrow();
  });
});
