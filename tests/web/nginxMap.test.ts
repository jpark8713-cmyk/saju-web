// deploy/nginx.conf의 IPv6 /64 묶음 규칙 검사(D-031). nginx를 띄우지 않고, map 규칙을 nginx 방식(위에서부터 처음 맞는 규칙)대로
// 자바스크립트 정규식으로 옮겨 평가한다. 주소는 nginx처럼 0이 2칸 이상 이어질 때만 ::로 줄인 표기를 쓴다(URL 표준 표기와 같다).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clientIp } from '../../src/web/clientIp';

interface Rule {
  re: RegExp;
  value: string;
}

function loadMap(): Rule[] {
  const conf = readFileSync(join(process.cwd(), 'deploy', 'nginx.conf'), 'utf8');
  const block = /map \$remote_addr \$limit_key \{([\s\S]*?)\n\}/.exec(conf)?.[1];
  if (!block) throw new Error('map 블록이 없습니다');
  const rules: Rule[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('default ')) continue;
    // nginx는 따옴표 밖의 { }를 블록 경계로 읽는다. 정규식 규칙은 반드시 "~..." 형태여야 한다
    const m = /^"~([^"]+)"\s+(\S+);$/.exec(line);
    if (!m) throw new Error(`따옴표로 감싸지 않은 map 규칙: ${line}`);
    rules.push({ re: new RegExp(m[1]!.replace(/\(\?P</g, '(?<')), value: m[2]! });
  }
  return rules;
}

const RULES = loadMap();

/** nginx map 평가: 처음 맞는 규칙의 값에서 $이름을 바꾼다. 맞는 규칙이 없으면 주소 전체(default) */
function nginxKey(addr: string): string {
  for (const r of RULES) {
    const m = r.re.exec(addr);
    if (m) return r.value.replace(/\$([A-Za-z0-9_]+)/g, (_, n: string) => m.groups?.[n] ?? '');
  }
  return `addr:${addr}`;
}

/** 8칸 숫자 → nginx가 쓰는 표기(소문자, 앞자리 0 생략, 0이 2칸 이상 이어진 가장 긴 구간만 ::) */
function canonical(groups: number[]): string {
  return new URL(`http://[${groups.map((g) => g.toString(16)).join(':')}]/`).hostname.slice(1, -1);
}

function rng(seed: number) {
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

describe('nginx 설정 문법', () => {
  it('map 블록의 모든 정규식 규칙은 큰따옴표로 감싸고, 따옴표 밖에 { }가 없다', () => {
    const conf = readFileSync(join(process.cwd(), 'deploy', 'nginx.conf'), 'utf8');
    const block = /map \$remote_addr \$limit_key \{([\s\S]*?)\n\}/.exec(conf)![1]!;
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      expect(line.replace(/"[^"]*"/g, ''), line).not.toMatch(/[{}]/);
    }
    expect(RULES.length).toBe(24);
  });
});

describe('nginx IPv6 /64 묶음', () => {
  const rand = rng(42);
  /** 0이 자주 나오게 만든 칸 (줄임 표기가 여러 모양으로 나오도록) */
  const group = () => (rand() < 0.45 ? 0 : Math.floor(rand() * 0x10000));
  const prefixes = Array.from({ length: 300 }, () => [group(), group(), group(), group()]);
  // 앞자리가 모두 0이거나 일부만 0인 묶음도 꼭 넣는다
  prefixes.push([0x2001, 0xdb8, 0, 0], [0x2001, 0xdb8, 0xabcd, 0], [0x2001, 0, 0, 0], [0, 0, 0, 0], [0x2001, 0xdb8, 0, 1], [0x2001, 0, 0, 5]);

  it('같은 /64 안의 주소는 표기가 달라도 같은 키, 다른 /64는 다른 키다', () => {
    const keyOfPrefix = new Map<string, string>();
    const prefixOfKey = new Map<string, string>();
    for (const p of prefixes) {
      const id = p.join(':');
      for (let i = 0; i < 12; i++) {
        const host = i === 0 ? [0, 0, 0, 0] : i === 1 ? [0, 0, 0, 1] : [group(), group(), group(), group()];
        const addr = canonical([...p, ...host]);
        const key = nginxKey(addr);
        expect(key.startsWith('addr:'), `${addr}가 묶이지 않았어요`).toBe(false);
        const seen = keyOfPrefix.get(id);
        if (seen) expect(key, `${addr}`).toBe(seen);
        else keyOfPrefix.set(id, key);
        const owner = prefixOfKey.get(key);
        if (owner) expect(owner, `${addr}의 키 ${key}가 다른 /64와 겹쳐요`).toBe(id);
        else prefixOfKey.set(key, id);
      }
    }
  });

  it('앱의 /64 묶음(clientIp)과 같은 묶음을 만든다', () => {
    const appKey = (addr: string) => clientIp(new Request('http://x', { headers: { 'x-real-ip': addr } }), { TRUST_PROXY: 'true' });
    for (const p of prefixes.slice(0, 80)) {
      const a = canonical([...p, 0, 0, 0, 7]);
      const b = canonical([...p, group(), 1, group(), 2]);
      expect(nginxKey(a) === nginxKey(b)).toBe(appKey(a) === appKey(b));
      expect(appKey(a)).toBe(appKey(b));
    }
  });

  it('리뷰에서 빠졌던 줄임 표기 예시가 묶인다', () => {
    expect(nginxKey('2001:db8:abcd::5')).toBe(nginxKey('2001:db8:abcd:0:1:2:3:4'));
    expect(nginxKey('2001:db8::1')).toBe(nginxKey('2001:db8::1:2:3:4'));
    expect(nginxKey('2001:db8:1::5')).toBe(nginxKey('2001:db8:1:0:ffff:1:2:3'));
    expect(nginxKey('::1')).toBe('0:0:0:0');
    expect(nginxKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
    // IPv4는 map에 걸리지 않고 주소 하나씩 센다(default)
    expect(nginxKey('192.0.2.1')).toBe('addr:192.0.2.1');
  });
});
