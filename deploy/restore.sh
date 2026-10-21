#!/usr/bin/env bash
# 백업에서 복원 (D-030, D-031). 절차와 확인 항목: Docs/deploy.md 5장.
# 사용(root):
#   bash -c 'set -a; . /etc/saju/backup.env; set +a; /opt/saju/deploy/restore.sh saju/sqlite/saju-20261021T030000Z.db'
#   서버에 있는 파일로 복원: restore.sh --local <파일 경로>   (파일은 복사해서 쓰고, 원본은 지우지 않는다)
#     받는 경로(링크를 푼 실제 경로 기준): 데이터 폴더 안(컨테이너 안에서 앱 권한으로 꺼낸다) 또는 root 전용 가져오기 폴더(LOCAL_IMPORT_DIR) 안.
# 필요: /etc/saju/backup.env (backup-hourly.sh와 같은 값), 앱 이미지 이름 IMAGE(기본 saju-web:current)
#
# 내려받은 사본은 root만 쓰는 준비 폴더(RESTORE_STAGE)에 두고, 컨테이너에는 그 파일 하나만 읽기 전용으로 연결한다.
# 데이터 폴더(/data, 앱 사용자 소유) 안에서는 root로 파일을 만들거나 권한·소유자를 바꾸지 않는다(심볼릭 링크 공격 방지).
set -euo pipefail
umask 077

ENDPOINT="${OBJECT_STORAGE_ENDPOINT:-https://kr.object.ncloudstorage.com}"
CONTAINER="${CONTAINER:-saju-web}"
DATA_DIR="${DATA_DIR:-/srv/saju/data}"
IMAGE="${IMAGE:-saju-web:current}"
STAGE="${RESTORE_STAGE:-/var/lib/saju/restore}"
APP_UID="${APP_UID:-1000}"
IMPORT_DIR="${LOCAL_IMPORT_DIR:-/var/lib/saju/import}"
# 복원할 파일 크기 상한(기본 5GiB). 이보다 크면 받지 않는다(무한히 읽히는 파일로 디스크를 채우지 못하게)
MAX_BYTES="${MAX_RESTORE_BYTES:-5368709120}"

MODE=remote
if [ "${1:-}" = "--local" ]; then
  MODE=local
  shift
fi
SRC="${1:?복원할 백업(Object Storage 키, 또는 --local <파일 경로>)을 지정하세요}"
NAME="$(basename -- "$SRC")"
# 이상한 이름은 받지 않는다(경로 조작·옵션으로 읽히는 이름 방지)
case "$NAME" in
  saju-*.db) ;;
  *) echo "백업 파일 이름은 saju-<시각>.db 형식이어야 해요: ${NAME}" >&2; exit 2 ;;
esac

# 준비 폴더: root 소유, 다른 사용자는 들어가 읽기만(711). 링크면 쓰지 않는다
if [ -L "$STAGE" ]; then echo "준비 폴더가 심볼릭 링크라 쓰지 않아요: ${STAGE}" >&2; exit 2; fi
install -d -o root -g root -m 0711 "$STAGE"
COPY="${STAGE}/restore-$$-${NAME}"
IN_CONTAINER="/restore/${NAME}"
STOPPED=0

# 끝날 때: 준비 사본을 지우고, 서버를 멈췄다면 DB가 있을 때만 다시 켠다.
# DB가 없으면(바꿔 넣기와 되돌리기가 모두 실패한 경우) 켜지 않는다. 켜면 빈 DB가 새로 만들어진다.
on_exit() {
  local code=$?
  rm -f -- "$COPY"
  if [ "$STOPPED" = 1 ]; then
    if [ -s "${DATA_DIR}/saju.db" ]; then
      docker start "$CONTAINER" >/dev/null && echo "서버를 다시 켰어요."
    else
      echo "DB 파일(${DATA_DIR}/saju.db)이 없어 서버를 켜지 않았어요. ${DATA_DIR}/saju.db.before-restore-* 파일을 확인해 되돌린 뒤 docker start ${CONTAINER} 하세요." >&2
      code=1
    fi
  fi
  exit "$code"
}
trap on_exit EXIT

# 표준 입력을 준비 사본에 쓰되 상한을 넘으면 실패한다
copy_capped() {
  head -c "$((MAX_BYTES + 1))" > "$COPY"
  if [ "$(stat -c %s "$COPY")" -gt "$MAX_BYTES" ]; then
    echo "복원할 파일이 상한(${MAX_BYTES} bytes)보다 커서 받지 않아요" >&2
    exit 2
  fi
}

if [ "$MODE" = local ]; then
  # 링크를 모두 푼 실제 경로로 판단한다. 링크가 허용 폴더 밖을 가리키면 거부한다
  REAL="$(realpath -e -- "$SRC" 2>/dev/null)" || { echo "파일이 없어요: ${SRC}" >&2; exit 2; }
  DATA_REAL="$(realpath -e -- "$DATA_DIR")"
  install -d -o root -g root -m 0700 "$IMPORT_DIR"
  IMPORT_REAL="$(realpath -e -- "$IMPORT_DIR")"
  case "$REAL" in
    "$DATA_REAL"/*)
      # 데이터 폴더는 앱 사용자 소유라 root가 직접 읽지 않는다. 일회용 컨테이너 안에서 앱 사용자 권한으로 꺼낸다
      # (그 안의 링크는 컨테이너 밖 서버 파일을 가리키지 못한다)
      REL="${REAL#"$DATA_REAL"/}"
      docker run --rm --network none -v "${DATA_DIR}:/data:ro" --entrypoint cat "$IMAGE" -- "/data/${REL}" | copy_capped ;;
    "$IMPORT_REAL"/*)
      # root 전용 가져오기 폴더: 일반 파일만 받는다
      [ -f "$REAL" ] && [ ! -L "$REAL" ] || { echo "일반 파일이 아니에요: ${SRC}" >&2; exit 2; }
      copy_capped < "$REAL" ;;
    *)
      echo "--local 파일은 데이터 폴더(${DATA_DIR}) 또는 가져오기 폴더(${IMPORT_DIR}) 안에 있어야 해요(링크를 푼 실제 경로: ${REAL})" >&2
      exit 2 ;;
  esac
else
  : "${BACKUP_BUCKET:?BACKUP_BUCKET이 필요합니다}"
  aws --endpoint-url "$ENDPOINT" s3 cp "s3://${BACKUP_BUCKET}/${SRC}" "$COPY" --only-show-errors
fi
# 컨테이너 안 앱 사용자(uid 1000)만 읽을 수 있게 한다(준비 폴더가 root 소유라 이 파일은 바꿔치기할 수 없다)
chown "${APP_UID}:${APP_UID}" "$COPY"
chmod 600 "$COPY"

restore() {
  docker run --rm -v "${DATA_DIR}:/data" -v "${COPY}:${IN_CONTAINER}:ro" -e DATABASE_URL=file:/data/saju.db "$IMAGE" npm run -s db:restore -- "$IN_CONTAINER" "$@"
}

# 1) 서버를 멈추기 전에 백업 파일부터 확인한다(무결성, 표)
restore --check-only

# 2) 웹 서버를 멈추고 바꿔 넣는다. 원래 DB는 /data/saju.db.before-restore-<시각>(와 짝 맞는 -wal·-shm)으로 남는다(7일 뒤 정리된다).
#    바꿔 넣기가 실패하면 원래 DB가 제자리에 그대로 있다.
docker stop "$CONTAINER"
STOPPED=1
restore
echo "복원 완료. Docs/deploy.md 5장의 확인 항목을 점검하세요."
