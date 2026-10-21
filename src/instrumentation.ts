// 서버가 켜질 때 한 번 실행된다(Next.js instrumentation). Node.js 런타임에서만 시작 점검을 한다.
// 점검이 실패하면 요청을 받지 않도록 프로세스를 끝낸다(Next는 instrumentation 오류가 나도 프로세스를 띄워 둔다).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { runStartupChecks } = await import('./startup');
  try {
    await runStartupChecks();
  } catch (e) {
    console.error(`[시작 점검] 서버를 시작하지 않아요: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
