// 예행 모드(REHEARSAL_MODE=1) 배너(D-058). 모든 화면 맨 위에 보인다. PDF(인쇄)에는 넣지 않는다(globals.css의 @media print).
import { isRehearsal } from '../config/flags';

export function RehearsalBanner() {
  if (!isRehearsal()) return null;
  return (
    <div className="rehearsal-banner" role="status" data-testid="rehearsal-banner">
      리허설 서버 — 실제 결제 아님
    </div>
  );
}
