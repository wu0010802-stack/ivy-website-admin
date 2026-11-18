"""內容統計保存分頁進站時的跨日回訪分類，舊資料維持 NULL。"""
import sqlalchemy as sa
from alembic import op

revision = "d8b1a9e5c274"
down_revision = "d5e1f7a3b9c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("engagement_visits", sa.Column("returning", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("engagement_visits", "returning")
