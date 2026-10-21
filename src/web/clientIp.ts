// 요청한 쪽의 IP (횟수 제한용, 저장·기록하지 않는다).
// Next.js 15부터 요청 객체에 ip가 없다. 운영에서는 앞단 프록시(nginx)가 X-Real-IP를 덮어써 넣고 TRUST_PROXY=true로 둔다.
// TRUST_PROXY가 없으면 헤더를 믿지 않고 모든 요청을 한 묶음으로 센다(위조한 헤더로 제한을 피하지 못하게).
// IPv6는 앞 64비트(/64)로 묶는다. 한 사람이 받는 IPv6 주소 묶음 안에서 주소를 바꿔 가며 제한을 피하지 못하게 한다(D-030).
import { isIPv6 } from 'node:net';
import type { Env } from '../config/flags';

/** IPv6 주소를 /64 묶음으로 바꾼다 (예: 2001:db8:1:2::5 → 2001:db8:1:2::/64) */
export function ipv6Prefix64(ip: string): string {
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

export function clientIp(req: Request, env: Env = process.env): string {
  if (env.TRUST_PROXY !== 'true') return 'direct';
  const real = req.headers.get('x-real-ip')?.trim();
  if (!real || real.length > 64) return 'unknown';
  // IPv4가 섞인 IPv6(::ffff:1.2.3.4)는 IPv4로 본다
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(real);
  if (mapped) return mapped[1]!;
  return isIPv6(real) ? ipv6Prefix64(real.toLowerCase()) : real;
}
