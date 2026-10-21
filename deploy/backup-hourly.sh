#!/usr/bin/env bash
# 매시간 SQLite 백업 → NCP Object Storage 업로드 (D-030, D-031). 서버(호스트)에서 systemd 타이머(saju-backup.timer)가 실행한다.
# 필요: docker, aws CLI(S3 호환 클라이언트), /etc/saju/backup.env (권한 600)
#   BACKUP_BUCKET=버킷 이름
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = NCP API 인증키(이 버킷 권한만, 버전 삭제 권한 없음)
#   선택: BACKUP_PREFIX(기본 saju/sqlite), OBJECT_STORAGE_ENDPOINT(기본 https://kr.object.ncloudstorage.com),
#         CONTAINER(기본 saju-web), KEEP_LOCAL(기본 24), LOCAL_RETENTION_DAYS(기본 7)
#
# 데이터 폴더(/data)는 앱 사용자 소유라, 이 스크립트(root)는 그 안의 파일을 직접 만지지 않는다(심볼릭 링크로 서버 파일을 건드리게 하는 공격 방지).
# 정리·백업·업로드할 파일 읽기는 모두 컨테이너 안에서 앱 사용자 권한으로 한다(docker exec).
set -euo pipefail
umask 077

: "${BACKUP_BUCKET:?BACKUP_BUCKET이 필요합니다}"
PREFIX="${BACKUP_PREFIX:-saju/sqlite}"
ENDPOINT="${OBJECT_STORAGE_ENDPOINT:-https://kr.object.ncloudstorage.com}"
CONTAINER="${CONTAINER:-saju-web}"
KEEP_LOCAL="${KEEP_LOCAL:-24}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="saju-${STAMP}.db"
IN_CONTAINER="/data/backups/${NAME}"

s3() { aws --endpoint-url "$ENDPOINT" "$@"; }
app() { docker exec "$CONTAINER" "$@"; }

# 0) 버킷 보호 확인(필수 조건, Docs/deploy.md 5장). 하나라도 빠졌으면 올리지 않는다
VERSIONING="$(s3 s3api get-bucket-versioning --bucket "$BACKUP_BUCKET" --query Status --output text 2>/dev/null || true)"
if [ "$VERSIONING" != "Enabled" ]; then
  echo "버킷 버전 관리(삭제 방지)가 켜져 있지 않아 백업을 올리지 않아요: ${BACKUP_BUCKET} (상태: ${VERSIONING:-확인 불가})" >&2
  exit 1
fi
if ! s3 s3api get-bucket-encryption --bucket "$BACKUP_BUCKET" >/dev/null 2>&1; then
  echo "버킷 저장 암호화(SSE)가 설정돼 있지 않아 백업을 올리지 않아요: ${BACKUP_BUCKET}" >&2
  exit 1
fi
PUBLIC_GRANTS="$(s3 s3api get-bucket-acl --bucket "$BACKUP_BUCKET" --query "Grants[?Grantee.URI!=null].Grantee.URI" --output text 2>/dev/null || echo "확인 불가")"
case "$PUBLIC_GRANTS" in
  *AllUsers*|*AuthenticatedUsers*|*"확인 불가"*)
    echo "버킷이 비공개인지 확인하지 못했거나 공개 권한이 있어 백업을 올리지 않아요: ${BACKUP_BUCKET}" >&2
    exit 1 ;;
esac

# 1) 폴더 권한(소유자만, 700)과 정리. 정리는 백업 전에 해서 업로드가 계속 실패해도 서버 사본이 쌓이지 않게 한다.
#    정리는 이름의 시각 기준이다: 백업 사본은 최근 KEEP_LOCAL개, 복원 때 남긴 원래 DB는 LOCAL_RETENTION_DAYS일.
app mkdir -p /data/backups
app chmod 700 /data /data/backups
#    이번 백업이 하나 더해지므로 KEEP_LOCAL-1개만 남겨 둔다(백업 뒤 KEEP_LOCAL개)
app npm run -s db:prune -- --keep "$(( KEEP_LOCAL > 1 ? KEEP_LOCAL - 1 : 1 ))" --retention-days "$LOCAL_RETENTION_DAYS"

# 2) 온라인 백업(서버를 멈추지 않는다). 사본은 파일 하나이고 권한 600이다
app npm run -s db:backup -- "$IN_CONTAINER"
LOCAL_SIZE="$(app stat -c %s "$IN_CONTAINER")"
LOCAL_SHA="$(app sha256sum "$IN_CONTAINER" | cut -d' ' -f1)"

# 3) 임시 이름으로 올린다. 읽기가 도중에 실패해도 잘린 파일이 정상 이름으로 남지 않게 한다(D-031)
#    임시 이름은 .incoming/ 아래 .part다. 확인에 실패하면 그대로 두고 실패로 끝난다(7일 수명 주기가 지운다)
FINAL_KEY="${PREFIX}/${NAME}"
TEMP_KEY="${PREFIX}/.incoming/${NAME}.part"
app cat "$IN_CONTAINER" | s3 s3 cp - "s3://${BACKUP_BUCKET}/${TEMP_KEY}" --expected-size "$LOCAL_SIZE" --only-show-errors

# 4) 올린 것을 확인한다: 크기, 그리고 다시 내려받아 계산한 SHA-256이 컨테이너 안 사본과 같아야 한다
REMOTE_SIZE="$(s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$TEMP_KEY" --query ContentLength --output text)"
if [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
  echo "업로드 크기가 달라 정상 이름으로 바꾸지 않았어요: ${TEMP_KEY} (local=${LOCAL_SIZE} remote=${REMOTE_SIZE})" >&2
  exit 1
fi
REMOTE_SHA="$(s3 s3 cp "s3://${BACKUP_BUCKET}/${TEMP_KEY}" - --only-show-errors | sha256sum | cut -d' ' -f1)"
if [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
  echo "업로드 체크섬이 달라 정상 이름으로 바꾸지 않았어요: ${TEMP_KEY}" >&2
  exit 1
fi

# 5) 확인이 끝난 것만 정상 이름으로 복사하고(체크섬을 메타데이터로 남긴다) 임시 이름을 지운다
s3 s3api copy-object --bucket "$BACKUP_BUCKET" --copy-source "${BACKUP_BUCKET}/${TEMP_KEY}" --key "$FINAL_KEY"   --metadata "sha256=${LOCAL_SHA}" --metadata-directive REPLACE >/dev/null
FINAL_SIZE="$(s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$FINAL_KEY" --query ContentLength --output text)"
if [ "$FINAL_SIZE" != "$LOCAL_SIZE" ]; then
  echo "정상 이름으로 복사한 크기가 달라요: ${FINAL_KEY}" >&2
  exit 1
fi
s3 s3api delete-object --bucket "$BACKUP_BUCKET" --key "$TEMP_KEY" >/dev/null || echo "임시 이름을 지우지 못했어요(수명 주기가 지워요): ${TEMP_KEY}" >&2

echo "백업 완료: ${FINAL_KEY} (${LOCAL_SIZE} bytes, sha256 ${LOCAL_SHA})"
