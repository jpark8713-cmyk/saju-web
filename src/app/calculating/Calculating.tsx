'use client';
// 화면 3: 계산 중. POST /api/chart로 무료 미리보기를 받는다. 10초가 지나면 다시 시도 안내를 보여 준다.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewView } from '../../report/view';
import type { FieldErrors } from '../../web/birthForm';
import { load, save } from '../../web/session';

export const SLOW_AFTER_MS = 10_000;

export function Calculating() {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    const birth = load('saju.birth');
    if (!birth) {
      router.replace('/input');
      return;
    }
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setSlow(false);
    setFailed(false);
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    try {
      const res = await fetch('/api/chart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ birth }),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as { preview?: PreviewView; errors?: FieldErrors };
      if (res.ok && data.preview) {
        save('saju.preview', data.preview);
        router.replace('/preview');
      } else if (res.status === 400 && data.errors) {
        // 서버 검증에서 걸리면 입력 화면으로 돌아가 해당 칸 아래에 문구를 보여 준다
        save('saju.inputErrors', data.errors);
        router.replace('/input');
      } else {
        setFailed(true);
      }
    } catch {
      if (!ctrl.signal.aborted) setFailed(true);
    } finally {
      clearTimeout(timer);
    }
  }, [router]);

  useEffect(() => {
    void run();
    return () => inFlight.current?.abort();
  }, [run]);

  return (
    <div className="section" aria-live="polite">
      <h1 className="h1">사주를 계산하고 있어요</h1>
      {!failed && <p className="meta">절입 시각과 태어난 지역의 시차를 반영해 네 기둥을 세우는 중이에요. 몇 초면 끝나요.</p>}
      {(slow || failed) && (
        <div className="box section" data-testid="calc-retry">
          <p style={{ margin: 0 }}>{failed ? '계산 중에 문제가 생겼어요.' : '평소보다 오래 걸리고 있어요.'} 다시 시도해 주세요.</p>
          <button type="button" className="button" onClick={() => void run()}>
            다시 시도
          </button>
          <a href="/input">입력 화면으로 돌아가기</a>
        </div>
      )}
    </div>
  );
}
