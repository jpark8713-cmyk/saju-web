#!/usr/bin/env bash
# 로컬 Docker 리허설(Docs/REHEARSAL.md). Docker Desktop이 있는 PC의 Git Bash에서 저장소 루트에서 실행한다.
#   bash scripts/rehearsal/local-rehearsal.sh            # 빌드 → 시작 거부 → 예행 모드 → 목 결제 → 백업·복원(실제 AI 호출 없음)
#   ALLOW_AI_CALL=1 bash scripts/rehearsal/local-rehearsal.sh   # 위 + 실제 Claude API 1번으로 리포트·PDF(약 $0.25)
#   SKIP_BUILD=1 ...  이미 만든 이미지를 쓴다. KEEP=1 ... 끝나도 컨테이너·볼륨을 지우지 않는다.
# 비밀값은 .env.rehearsal(커밋하지 않음)에만 둔다. 이 스크립트는 값을 출력하지 않는다.
set -euo pipefail
# Git Bash(윈도)가 /data 같은 인자를 윈도 경로로 바꾸지 않게 한다
export MSYS_NO_PATHCONV=1

IMAGE="${IMAGE:-saju-web:rehearsal}"
NAME="saju-rehearsal"
VOLUME="saju-rehearsal-data"
PORT="${HOST_PORT:-3080}"
ENV_FILE=".env.rehearsal"
OUT="rehearsal-output/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
LOG="$OUT/summary.txt"
say() { echo "$*" | tee -a "$LOG"; }
fail() { say "실패: $*"; exit 1; }

command -v docker >/dev/null || fail "docker 명령이 없어요. Docker Desktop을 켜고 새 터미널에서 다시 실행하세요"
docker info >/dev/null 2>&1 || fail "Docker 엔진에 연결되지 않아요. Docker Desktop이 켜져 있는지 확인하세요"
[ -f "$ENV_FILE" ] || fail "$ENV_FILE 이 없어요. cp .env.rehearsal.example .env.rehearsal 후 값을 채우세요"
grep -qE '^REFUND_ID_SECRET=.{32,}' "$ENV_FILE" || fail "$ENV_FILE 의 REFUND_ID_SECRET이 32자 미만이에요"

say "== 로컬 리허설 $(date '+%Y-%m-%d %H:%M:%S') / 이미지 $IMAGE / 포트 $PORT"

# 1) 빌드(이미지 크기·빌드 시간). 빌드 중 메모리는 Docker Desktop의 메모리 그래프나 작업 관리자로 같이 본다
if [ "${SKIP_BUILD:-}" != "1" ]; then
  t0=$(date +%s)
  docker build --pull -t "$IMAGE" . 2>&1 | tail -5 | tee -a "$LOG"
  say "빌드 시간: $(( $(date +%s) - t0 ))초"
fi
say "이미지 크기: $(docker image inspect -f '{{.Size}}' "$IMAGE" | awk '{printf "%.0fMB", $1/1024/1024}')"

# 2) 시작 거부 6가지: 종료 코드 1과 "[시작 점검] 서버를 시작하지 않아요"가 나와야 한다
refuse() {
  local label="$1"; shift
  docker volume create saju-rehearsal-refuse >/dev/null
  local cid code logs
  cid=$(docker run -d --env-file "$ENV_FILE" -e REHEARSAL_MODE= -e PAYMENT_PROVIDER= "$@" -v saju-rehearsal-refuse:/data "$IMAGE")
  code=$(timeout 90 docker wait "$cid" || echo "timeout")
  logs=$(docker logs "$cid" 2>&1 | grep -o '\[시작 점검\] 서버를 시작하지 않아요.*' | head -1 || true)
  docker rm -f "$cid" >/dev/null
  if [ "$code" = "1" ] && [ -n "$logs" ]; then say "  통과(거부됨) $label: ${logs:0:140}"; else say "  실패 $label: 종료 코드 $code (뜨면 안 되는데 떴거나 다른 이유로 멈춤)"; REFUSE_FAIL=1; fi
}
REFUSE_FAIL=0
say "== 시작 거부"
refuse "NODE_ENV=development" -e NODE_ENV=development
refuse "NODE_ENV=test" -e NODE_ENV=test
refuse "가짜 LLM(예행 모드여도)" -e ENABLE_FAKE_LLM=true -e REHEARSAL_MODE=1 -e PAYMENT_PROVIDER=mock
refuse "예행 모드 없이 목 결제" -e PAYMENT_PROVIDER=mock
refuse "검수 전 주제(예행 모드 없음)"
refuse "예행 모드 + 실제 PG 키" -e REHEARSAL_MODE=1 -e PAYMENT_PROVIDER=mock -e PAYMENT_SECRET_KEY=rehearsal-dummy
docker volume rm saju-rehearsal-refuse >/dev/null
[ "$REFUSE_FAIL" = "0" ] || fail "시작 거부 확인 실패"

# 3) 예행 모드 + 목 결제로 띄우기
say "== 예행 모드 실행"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --env-file "$ENV_FILE" -e REHEARSAL_MODE=1 -e PAYMENT_PROVIDER=mock \
  -e APP_ORIGIN="http://localhost:$PORT" -v "$VOLUME:/data" -p "127.0.0.1:$PORT:3000" "$IMAGE" >/dev/null
for i in $(seq 1 60); do
  curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
say "상태 확인: $(curl -fs "http://localhost:$PORT/api/health" || echo '응답 없음')"
say "메모리(시작 직후): $(docker stats --no-stream --format '{{.MemUsage}}' "$NAME")"

# 4) 주문 → 목 결제 → (ALLOW_AI_CALL=1이면) 생성·PDF
say "== 결제 흐름"
if [ "${ALLOW_AI_CALL:-}" = "1" ]; then
  say "실제 Claude API를 1번 불러요(약 \$0.25)"
  node scripts/rehearsal/flow.mjs "http://localhost:$PORT" "$OUT" --with-ai 2>&1 | tee -a "$LOG"
else
  node scripts/rehearsal/flow.mjs "http://localhost:$PORT" "$OUT" 2>&1 | tee -a "$LOG"
fi
say "메모리(흐름 뒤): $(docker stats --no-stream --format '{{.MemUsage}}' "$NAME")"

# 5) DB 백업·검사·다른 경로로 복원
say "== 백업·복원"
docker exec "$NAME" sh -c 'mkdir -p /data/backups && npm run -s db:backup -- /data/backups/rehearsal.db' 2>&1 | tail -1 | tee -a "$LOG"
docker exec "$NAME" npm run -s db:restore -- /data/backups/rehearsal.db --check-only 2>&1 | tail -1 | tee -a "$LOG"
docker stop "$NAME" >/dev/null
docker run --rm -v "$VOLUME:/data" -e DATABASE_URL=file:/data/restore-test/saju.db "$IMAGE" sh -c \
  'mkdir -p /data/restore-test && npm run -s db:restore -- /data/backups/rehearsal.db && npm run -s db:backup -- /data/restore-test/check.db' 2>&1 | tail -2 | tee -a "$LOG"
say "복원한 DB의 표별 건수가 위 백업의 건수와 같으면 통과예요"

# 6) 정리
if [ "${KEEP:-}" != "1" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  say "컨테이너·볼륨을 지웠어요(이미지 $IMAGE 는 남겨요)"
fi
say "끝. 결과: $OUT"
