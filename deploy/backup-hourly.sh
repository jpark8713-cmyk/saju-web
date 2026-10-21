#!/usr/bin/env bash
# 매시간 SQLite 백업 → NCP Object Storage 업로드 (D-030). 서버(호스트)에서 systemd 타이머(saju-backup.timer)가 실행한다.
# 필요: docker, aws CLI(S3 호환 클라이언트), /etc/saju/backup.env (권한 600)
#   BACKUP_BUCKET=버킷 이름
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = NCP API 인증키(Object Storage 권한만)
#   선택: BACKUP_PREFIX(기본 saju/sqlite), OBJECT_STORAGE_ENDPOINT(기본 https://kr.object.ncloudstorage.com),
#         CONTAINER(기본 saju-web), DATA_DIR(기본 /srv/saju/data), KEEP_LOCAL(기본 24)
set -euo pipefail

: "${BACKUP_BUCKET:?BACKUP_BUCKET이 필요합니다}"
PREFIX="${BACKUP_PREFIX:-saju/sqlite}"
ENDPOINT="${OBJECT_STORAGE_ENDPOINT:-https://kr.object.ncloudstorage.com}"
CONTAINER="${CONTAINER:-saju-web}"
DATA_DIR="${DATA_DIR:-/srv/saju/data}"
KEEP_LOCAL="${KEEP_LOCAL:-24}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="saju-${STAMP}.db"

# 1) 컨테이너 안에서 온라인 백업(서버를 멈추지 않는다). 사본은 같은 볼륨의 backups/ 아래에 만든다
docker exec "$CONTAINER" mkdir -p /data/backups
docker exec "$CONTAINER" npm run -s db:backup -- "/data/backups/${NAME}"

# 2) Object Storage에 올린다. 올린 뒤 크기가 같은지 확인한다
LOCAL="${DATA_DIR}/backups/${NAME}"
aws --endpoint-url "$ENDPOINT" s3 cp "$LOCAL" "s3://${BACKUP_BUCKET}/${PREFIX}/${NAME}" --only-show-errors
REMOTE_SIZE="$(aws --endpoint-url "$ENDPOINT" s3api head-object --bucket "$BACKUP_BUCKET" --key "${PREFIX}/${NAME}" --query ContentLength --output text)"
LOCAL_SIZE="$(stat -c %s "$LOCAL")"
if [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
  echo "업로드 크기가 다릅니다: local=${LOCAL_SIZE} remote=${REMOTE_SIZE}" >&2
  exit 1
fi

# 3) 서버에는 최근 KEEP_LOCAL개만 남긴다(Object Storage 보관 기간은 버킷 수명 주기 규칙으로 정한다)
ls -1t "${DATA_DIR}/backups"/saju-*.db 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm -f

echo "백업 완료: ${PREFIX}/${NAME} (${LOCAL_SIZE} bytes)"
