"""素材衍生檔記大小，配額把衍生檔算進去（2026-10-20 稽核 #03）

`media_variants.size_bytes`：衍生檔（縮圖、中圖、大圖、poster、桌機／手機版影片）
寫入儲存體時的位元組數。以前配額只加總原檔，背景轉檔寫出的版本完全不算。

新欄位 nullable、既有資料不回填：檔案可能在 S3 上，migration 不去讀儲存體。
NULL 在配額裡當 0（跟改版前一樣不算），之後新寫的衍生檔都有值。不改既有資料，
不需要先備份正式庫；上一版程式不讀這個欄位，先跑 migration 再換程式也相容。

降級直接刪欄位。

Revision ID: a6c2e9f4b8d1
Revises: b8e2d6a4f931
Create Date: 2026-10-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a6c2e9f4b8d1"
down_revision = "b8e2d6a4f931"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_variants", sa.Column("size_bytes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("media_variants", "size_bytes")
