FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.8.22 \
    && groupadd --gid 10001 website && useradd --uid 10001 --gid website --no-create-home website
RUN install -d -o 10001 -g 10001 -m 750 /home/website
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend ./
RUN uv sync --frozen --no-dev
COPY content /app/content
COPY deploy/api-start.py /app/api-start.py
COPY deploy/check_schema.py /app/check-schema.py
ENV PATH=/app/backend/.venv/bin:$PATH PORT=8000 WEBSITE_MEDIA_ROOT=/data/media
EXPOSE 8000
CMD ["python", "/app/api-start.py"]
