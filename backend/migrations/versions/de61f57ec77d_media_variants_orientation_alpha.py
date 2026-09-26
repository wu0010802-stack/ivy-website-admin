"""素材：舊縮圖與去背圖的衍生檔先退出 srcset、依 EXIF 轉正的照片寬高對調

Revision ID: de61f57ec77d
Revises: d6f2a8c41b37
Create Date: 2026-09-26

B10 審查意見。c4d8e2f6a913 已在正式庫執行（不能改），它依原檔寬高回填了舊
縮圖的寬高，官網 srcset 從此會選到這些縮圖；但有兩種衍生檔的內容是錯的：

1. 2026-09-25 以前上傳的圖片（sha256 為 NULL）：舊程式產生縮圖時沒有依 EXIF
   拍攝方向轉正，手機直拍的照片縮圖是躺著的，後台點焦點也點在躺著的縮圖上。
2. PNG、WebP、GIF：衍生檔一律轉成 RGB，去背圖的透明處變成黑底（線稿用
   multiply 疊色時整塊變黑）。migration 讀不到檔案、分不出哪些真的有透明，
   這三種格式一律先退出。

這些縮圖與大圖的寬高清成 NULL：官網只把有寬度的衍生檔放進 srcset，所以會改
用原檔（瀏覽器依 EXIF 轉正、保留透明），後台點焦點也改用原檔。部署後執行
`python -m app.cli regenerate-media-variants --apply` 重新產生（依 EXIF 轉正、
保留透明），寬高補回來後就回到 srcset。

3. 2026-09-25 之後上傳的照片（sha256 有值）：縮圖已依 EXIF 轉正，但素材記的
   是原檔未轉正的寬高，srcset 的寬度描述與 <img width/height> 長寬對調。縮圖
   跟素材一橫一直的，素材寬高對調成轉正後的尺寸（要在第 2 步清掉縮圖寬高
   之前做）。舊照片（sha256 為 NULL）的縮圖沒轉正、比不出來，由上面的指令
   重讀原檔更正。

只改寬高，不刪檔案、不動結構，有資料的正式庫可以直接套。downgrade 不還原：
寬高為 NULL 的衍生檔、轉正後的寬高，上一版程式本來就能正確處理（前者不放進
srcset，後者正是上一版程式替新上傳照片產生的縮圖尺寸），而且還原成回填值
只會讓躺著的縮圖與黑底圖回到官網。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "de61f57ec77d"
down_revision = "d6f2a8c41b37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE media_assets AS a
            SET width = a.height, height = a.width
            FROM media_variants AS v
            WHERE v.media_id = a.id
              AND v.kind = 'THUMBNAIL'
              AND a.kind = 'IMAGE'
              AND a.sha256 IS NOT NULL
              AND v.width IS NOT NULL AND v.height IS NOT NULL
              AND a.width IS NOT NULL AND a.height IS NOT NULL
              AND ((a.width > a.height AND v.width < v.height)
                OR (a.width < a.height AND v.width > v.height))
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE media_variants AS v
            SET width = NULL, height = NULL
            FROM media_assets AS a
            WHERE v.media_id = a.id
              AND a.kind = 'IMAGE'
              -- 轉成 text 再比：新庫一次套完整串 migration 時，LARGE 是同一個交易裡
              -- c4d8e2f6a913 才加的 enum 值，直接當 enum 常數用會被 PostgreSQL 拒絕
              -- （unsafe use of new value "LARGE"）。
              AND v.kind::text IN ('THUMBNAIL', 'LARGE')
              AND (a.sha256 IS NULL OR a.content_type IN ('image/png', 'image/webp', 'image/gif'))
            """
        )
    )


def downgrade() -> None:
    # 見上方說明：只改過資料，上一版程式能正確處理現在的值，不還原。
    pass
