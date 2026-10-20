# base image 以 multi-arch index digest 釘版（2026-09-29 讀自 Docker Hub）；tag 留給人看。
# 更新：換 tag 或定期吃安全更新時，重新讀 digest 後兩個一起改（步驟見 deploy/README.md）。
FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f
# 執行期以 uid 10001 跑、又設了 PYTHONDONTWRITEBYTECODE，.pyc 永遠寫不進映像：每次開機（alembic、
# check-schema、uvicorn 三個行程）都要重新編譯。所以在 build 時就把 bytecode 編好
# （UV_COMPILE_BYTECODE 編 .venv 的套件，compileall 編 app／migrations；2026-10-20）。
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.8.22 \
    && groupadd --gid 10001 website && useradd --uid 10001 --gid website --no-create-home website
RUN install -d -o 10001 -g 10001 -m 750 /home/website
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend ./
RUN uv sync --frozen --no-dev \
    && .venv/bin/python -m compileall -q -j 0 app migrations
# 內容 fixture 只有 web 那一份（2026-10-12 合一）；映像裡維持原路徑，正式站指令不變。
COPY web/server/data/site-fixture.json /app/content/site-fixture.json
COPY deploy/api-start.py /app/api-start.py
COPY deploy/check_schema.py /app/check-schema.py
ENV PATH=/app/backend/.venv/bin:$PATH PORT=8000 WEBSITE_MEDIA_ROOT=/data/media
EXPOSE 8000
CMD ["python", "/app/api-start.py"]
