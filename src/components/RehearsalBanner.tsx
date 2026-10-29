'use client';
// 예행 모드(REHEARSAL_MODE=1) 배너(D-058). 모든 화면 맨 위에 보인다. PDF(인쇄)에는 넣지 않는다(globals.css의 @media print).
// 모드는 서버를 띄울 때의 환경변수로 정해지므로 화면을 연 뒤 상태 확인 주소(/api/health)에서 읽는다.
// 서버에서 그리면 모든 화면을 요청마다 그려야 해 정적 페이지 캐시가 사라졌다(D-059). 저장하지 않고 화면을 열 때마다 묻는다.
import { useEffect, useState } from 'react';

export function RehearsalBanner() {
  const [rehearsal, setRehearsal] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((h: { mode?: string } | null) => {
        if (alive && h?.mode === 'rehearsal') setRehearsal(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!rehearsal) return null;
  return (
    <div className="rehearsal-banner" role="status" data-testid="rehearsal-banner">
      리허설 서버 — 실제 결제 아님
    </div>
  );
}
