"""管理員可綁定 Google 穩定帳號識別碼；不變更既有角色或密碼。"""
from alembic import op
import sqlalchemy as sa

revision = "b7930d2f6a10"
down_revision = "8cf3e2b5a641"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_sub", sa.String(255), nullable=True))
    op.create_unique_constraint("uq_users_google_sub", "users", ["google_sub"])


def downgrade() -> None:
    op.drop_constraint("uq_users_google_sub", "users", type_="unique")
    op.drop_column("users", "google_sub")
