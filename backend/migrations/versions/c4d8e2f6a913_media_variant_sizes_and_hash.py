"""素材：大圖衍生檔、衍生檔尺寸、原檔雜湊

Revision ID: c4d8e2f6a913
Revises: b3e7d1f9a524
Create Date: 2026-09-25

1. `media_variant_kind` 加一個值 `LARGE`：長邊 1600 的 WebP 大圖，原圖更大時
   才產生，官網 srcset 用。只新增 enum 值，既有資料不動。
2. 既有縮圖與 poster 的 `width`／`height` 以前沒存（都是 NULL）。縮圖是用
   Pillow 的 thumbnail((480, 480)) 等比縮小、不放大，所以由原檔尺寸就能算
   出來；原檔尺寸不明的維持 NULL（官網就不把它放進 srcset）。
3. `media_assets.sha256`：原檔內容雜湊，匯入既有素材時去重用。新欄位
   nullable，既有素材為 NULL（檔案可能在 S3 上，migration 不去讀）。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4d8e2f6a913"
down_revision = "b3e7d1f9a524"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_assets", sa.Column("sha256", sa.String(length=64), nullable=True))
    op.create_index("ix_media_assets_sha256", "media_assets", ["sha256"])
    # PostgreSQL 12 起 ADD VALUE 可以在交易裡執行，只是同一個交易內不能使用
    # 這個新值；這個 migration 沒有用到它。
    op.execute("ALTER TYPE media_variant_kind ADD VALUE IF NOT EXISTS 'LARGE'")
    op.execute(
        """
        UPDATE media_variants AS v
        SET width = CASE
                WHEN GREATEST(a.width, a.height) <= 480 THEN a.width
                WHEN a.width >= a.height THEN 480
                ELSE GREATEST(1, ROUND(a.width * 480.0 / a.height))::int
            END,
            height = CASE
                WHEN GREATEST(a.width, a.height) <= 480 THEN a.height
                WHEN a.height >= a.width THEN 480
                ELSE GREATEST(1, ROUND(a.height * 480.0 / a.width))::int
            END
        FROM media_assets AS a
        WHERE v.media_id = a.id
          AND v.width IS NULL
          AND a.width IS NOT NULL AND a.height IS NOT NULL
          AND a.width > 0 AND a.height > 0
        """
    )


def downgrade() -> None:
    # 大圖的記錄拿掉（檔案留在儲存空間裡成為孤兒檔，不影響官網：舊版程式不
    # 認得大圖，也不會組出它的網址）；PostgreSQL 不能直接刪 enum 值，改重建型別。
    op.execute("DELETE FROM media_variants WHERE kind = 'LARGE'")
    op.execute("ALTER TYPE media_variant_kind RENAME TO media_variant_kind_old")
    op.execute("CREATE TYPE media_variant_kind AS ENUM ('THUMBNAIL', 'POSTER')")
    op.execute(
        "ALTER TABLE media_variants ALTER COLUMN kind TYPE media_variant_kind "
        "USING kind::text::media_variant_kind"
    )
    op.execute("DROP TYPE media_variant_kind_old")
    op.drop_index("ix_media_assets_sha256", table_name="media_assets")
    op.drop_column("media_assets", "sha256")
