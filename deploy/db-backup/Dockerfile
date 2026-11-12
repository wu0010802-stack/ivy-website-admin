# 官網正式 DB 每日異地備份到 Cloudflare R2（2026-11-12），說明見同目錄 README.md。
# 用 postgres 18 的 client：pg_dump 只能備份「同版或更舊」的伺服器，選最新主版本，Railway Postgres 升級也不會壞。
# base image 以 multi-arch index digest 釘版（2026-11-12 讀自 Docker Hub），更新方式同 deploy/api.Dockerfile。
FROM postgres:18-alpine@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b
RUN apk add --no-cache age rclone ca-certificates \
    && adduser -D -H -u 10001 backup
COPY backup.sh /usr/local/bin/db-backup
USER 10001
# 不沿用 postgres 映像的 entrypoint（那會啟動資料庫）。
ENTRYPOINT []
CMD ["/usr/local/bin/db-backup"]
