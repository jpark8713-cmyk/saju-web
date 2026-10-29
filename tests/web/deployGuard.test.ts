// 운영 빌드 시작 거부와 예행 모드(D-058, 결제 안전 경계)
import { describe, expect, it } from 'vitest';
import { deploymentProblems } from '../../src/config/deployGuard';
import { isDevRuntime, isFakeLlmEnabled, isMockPaymentAllowed, isProductionBuild, runMode } from '../../src/config/flags';
import { runStartupChecks } from '../../src/startup';
import { MemoryStore } from '../../src/store/memory';

const PROD = 'phase-production-server';
const DEV = 'phase-development-server';
const REVIEWED = [{ id: 'wealth', enabled: true, reviewed: true }, { id: 'old', enabled: false, reviewed: false }];
const UNREVIEWED = [{ id: 'wealth', enabled: true, reviewed: false }, { id: 'career', enabled: true, reviewed: true }];
const BASE = { NODE_ENV: 'production' };
const problems = (env: Record<string, string>, phase = PROD, topics = REVIEWED) => deploymentProblems(env, phase, topics);

describe('운영 빌드 판정', () => {
  it('빌드 단계로만 판단한다(NODE_ENV와 무관)', () => {
    expect(isProductionBuild('phase-production-build')).toBe(true);
    expect(isProductionBuild(PROD)).toBe(true);
    expect(isProductionBuild(DEV)).toBe(false);
    expect(isProductionBuild(undefined)).toBe(false);
  });
  it('운영 빌드는 NODE_ENV가 development여도 개발 환경이 아니다', () => {
    expect(isDevRuntime({ NODE_ENV: 'development' }, PROD)).toBe(false);
    expect(isDevRuntime({ NODE_ENV: 'development' }, DEV)).toBe(true);
  });
});

describe('시작 거부 조건', () => {
  it('운영 빌드 + 기본 운영 설정 + 검수 마친 주제 → 통과', () => {
    expect(problems(BASE)).toEqual([]);
  });
  it.each(['development', 'test'])('A: 운영 빌드인데 NODE_ENV=%s → 거부', (v) => {
    expect(problems({ NODE_ENV: v }).join()).toContain(`NODE_ENV가 ${v}`);
  });
  it('가짜 LLM은 운영 빌드에서 어떤 경우에도 거부(예행 모드 포함, 값이 false여도)', () => {
    for (const env of [{ ...BASE, ENABLE_FAKE_LLM: 'true' }, { ...BASE, ENABLE_FAKE_LLM: 'false' }, { ...BASE, ENABLE_FAKE_LLM: 'true', REHEARSAL_MODE: '1' }]) {
      expect(problems(env).join()).toContain('ENABLE_FAKE_LLM');
    }
  });
  it('목 결제는 예행 모드에서만 허용', () => {
    expect(problems({ ...BASE, PAYMENT_PROVIDER: 'mock' }).join()).toContain('PAYMENT_PROVIDER=mock');
    expect(problems({ ...BASE, PAYMENT_PROVIDER: 'mock', REHEARSAL_MODE: '1' })).toEqual([]);
  });
  it('C: 판매 중인데 검수 전인 주제 → 거부(꺼진 주제는 보지 않는다), 예행 모드면 허용', () => {
    expect(problems(BASE, PROD, UNREVIEWED).join()).toContain('wealth');
    expect(problems(BASE, PROD, UNREVIEWED).join()).not.toContain('career');
    expect(problems({ ...BASE, REHEARSAL_MODE: '1' }, PROD, UNREVIEWED)).toEqual([]);
  });
  it('예행 모드와 실제 PG 설정은 함께 쓸 수 없다(개발 서버에서도)', () => {
    expect(problems({ ...BASE, REHEARSAL_MODE: '1', PAYMENT_PROVIDER: 'kakaopay' }).join()).toContain('실제 PG');
    expect(problems({ NODE_ENV: 'development', REHEARSAL_MODE: '1', PAYMENT_PROVIDER: 'toss' }, DEV).join()).toContain('실제 PG');
    // PG 키만 들어 있어도 막는다(목 결제와 함께여도)
    expect(problems({ ...BASE, REHEARSAL_MODE: '1', PAYMENT_PROVIDER: 'mock', PAYMENT_SECRET_KEY: 'x' }).join()).toContain('PAYMENT_SECRET_KEY');
    expect(problems({ ...BASE, REHEARSAL_MODE: '1', PAYMENT_CLIENT_KEY: 'x' }).join()).toContain('PAYMENT_CLIENT_KEY');
    expect(problems({ ...BASE, REHEARSAL_MODE: '1', PAYMENT_SECRET_KEY: '' })).toEqual([]);
  });
  it('REHEARSAL_MODE는 "1"만(true 같은 값은 거부)', () => {
    expect(problems({ ...BASE, REHEARSAL_MODE: 'true' }).join()).toContain('REHEARSAL_MODE');
  });
  it('개발 서버는 개발 기능·검수 전 주제를 막지 않는다', () => {
    expect(problems({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock', ENABLE_FAKE_LLM: 'true' }, DEV, UNREVIEWED)).toEqual([]);
  });
  it('여러 조건이 걸리면 모두 알린다', () => {
    expect(problems({ NODE_ENV: 'development', ENABLE_FAKE_LLM: 'true', PAYMENT_PROVIDER: 'mock' }, PROD, UNREVIEWED)).toHaveLength(4);
  });
});

describe('기능 스위치', () => {
  it('목 결제: 개발 서버는 NODE_ENV, 운영 빌드는 예행 모드로만 켠다', () => {
    expect(isMockPaymentAllowed({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock' }, undefined)).toBe(true);
    expect(isMockPaymentAllowed({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock' }, PROD)).toBe(false);
    expect(isMockPaymentAllowed({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', REHEARSAL_MODE: '1' }, PROD)).toBe(true);
    expect(isMockPaymentAllowed({ NODE_ENV: 'production', REHEARSAL_MODE: '1' }, PROD)).toBe(false);
  });
  it('가짜 LLM: 운영 빌드에서는 NODE_ENV·예행 모드와 관계없이 꺼진다', () => {
    expect(isFakeLlmEnabled({ NODE_ENV: 'development', ENABLE_FAKE_LLM: 'true', REHEARSAL_MODE: '1' }, PROD)).toBe(false);
    expect(isFakeLlmEnabled({ NODE_ENV: 'development', ENABLE_FAKE_LLM: 'true' }, DEV)).toBe(true);
  });
  it('실행 모드', () => {
    expect(runMode({ REHEARSAL_MODE: '1' }, PROD)).toBe('rehearsal');
    expect(runMode({}, PROD)).toBe('production');
    expect(runMode({ NODE_ENV: 'development' }, DEV)).toBe('development');
  });
});

describe('서버 시작 점검에서 거부', () => {
  const ok = { NODE_ENV: 'production', APP_ORIGIN: 'https://example.com', REFUND_ID_SECRET: 'x'.repeat(40) };
  const noDelivery = () => ({ store: new MemoryStore(), pdfs: null as never, renderPdf: async () => Buffer.from(''), email: null, origin: () => '' }) as never;
  it('조건이 걸리면 저장소를 열기 전에 멈춘다', async () => {
    let opened = false;
    const store = () => { opened = true; return new MemoryStore(); };
    await expect(runStartupChecks({ ...ok, ENABLE_FAKE_LLM: 'true' }, store, noDelivery, PROD)).rejects.toThrow(/운영 설정 점검 실패: .*ENABLE_FAKE_LLM/u);
    expect(opened).toBe(false);
  });
  it('예행 모드는 경고 한 줄과 함께 뜬다(지금 주제는 검수 전이어도)', async () => {
    const r = await runStartupChecks({ ...ok, TRUST_PROXY: 'true', REHEARSAL_MODE: '1', PAYMENT_PROVIDER: 'mock' }, () => new MemoryStore(), noDelivery, PROD);
    expect(r.warnings.join()).toContain('예행 모드');
  });
});
