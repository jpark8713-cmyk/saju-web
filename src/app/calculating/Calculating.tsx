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
  const [offline, setOffline] = useState(false);
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
    setOffline(false);
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    try {
      const res = await fetch('/api/chart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ birth }),
        signal: ctrl.signal,
      });
      // 서버 오류 페이지(HTML)면 JSON이 아니다
      const data = ((await res.json().catch(() => ({}))) as { preview?: PreviewView; errors?: FieldErrors });
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
      // 연결이 끊긴 경우(응답을 못 받음)
      if (!ctrl.signal.aborted) {
        setOffline(true);
        setFailed(true);
      }
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
          {failed ? (
            <>
              <p style={{ margin: 0 }} data-testid="calc-failed">
                {offline
                  ? '서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
                  : '서버에서 계산하지 못했어요. 입력값에 고칠 곳이 있으면 입력 화면의 해당 칸 아래에 알려 드리는데, 이번에는 그런 안내가 없어서 서버의 일시적인 문제일 가능성이 커요. 다시 시도해 주세요.'}
              </p>
              <p className="hint" style={{ margin: 0 }}>
                계속 같은 오류가 나면 입력 화면으로 돌아가 생년월일(양력·음력, 윤달), 태어난 시간, 태어난 지역이 맞는지 확인해 주세요.
              </p>
            </>
          ) : (
            <p style={{ margin: 0 }}>평소보다 오래 걸리고 있어요. 다시 시도해 주세요.</p>
          )}
          <button type="button" className="button" onClick={() => void run()}>
            다시 시도
          </button>
          <a href="/input">입력 화면으로 돌아가기</a>
        </div>
      )}
    </div>
  );
}
