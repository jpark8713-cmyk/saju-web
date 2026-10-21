#!/usr/bin/env bash
# 백업에서 복원 (D-030). 절차와 확인 항목: Docs/deploy.md 5장.
# 사용: sudo -E deploy/restore.sh <Object Storage 키 | 로컬 백업 파일 경로>
#   예) deploy/restore.sh saju/sqlite/saju-20261021T030000Z.db
# 필요: /etc/saju/backup.env (backup-hourly.sh와 같은 값), 앱 이미지 이름 IMAGE(기본 saju-web:current)
set -euo pipefail

SRC="${1:?복원할 백업(Object Storage 키 또는 파일 경로)을 지정하세요}"
ENDPOINT="${OBJECT_STORAGE_ENDPOINT:-https://kr.object.ncloudstorage.com}"
CONTAINER="${CONTAINER:-saju-web}"
DATA_DIR="${DATA_DIR:-/srv/saju/data}"
IMAGE="${IMAGE:-saju-web:current}"

mkdir -p "${DATA_DIR}/restore"
if [ -f "$SRC" ]; then
  FILE="$SRC"
else
  : "${BACKUP_BUCKET:?BACKUP_BUCKET이 필요합니다}"
  FILE="${DATA_DIR}/restore/$(basename "$SRC")"
  aws --endpoint-url "$ENDPOINT" s3 cp "s3://${BACKUP_BUCKET}/${SRC}" "$FILE" --only-show-errors
fi
IN_CONTAINER="/data/restore/$(basename "$FILE")"
[ "$FILE" = "${DATA_DIR}/restore/$(basename "$FILE")" ] || cp "$FILE" "${DATA_DIR}/restore/"

# 1) 서버를 멈추기 전에 백업 파일부터 확인한다(무결성, 표)
docker run --rm -v "${DATA_DIR}:/data" -e DATABASE_URL=file:/data/saju.db "$IMAGE" npm run -s db:restore -- "$IN_CONTAINER" --check-only

# 2) 웹 서버를 멈추고 바꿔 넣는다(원래 DB는 /data/saju.db.before-restore-<시각>으로 남는다)
docker stop "$CONTAINER"
docker run --rm -v "${DATA_DIR}:/data" -e DATABASE_URL=file:/data/saju.db "$IMAGE" npm run -s db:restore -- "$IN_CONTAINER"

# 3) 다시 켠다
docker start "$CONTAINER"
echo "복원 완료. Docs/deploy.md 5장의 확인 항목을 점검하세요."
