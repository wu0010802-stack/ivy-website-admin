"""管理員可自行綁定 LINE 穩定帳號識別碼；不變更既有角色或密碼。"""
from alembic import op
import sqlalchemy as sa

revision = "d41e6c2a9f58"
down_revision = "b6d1f8e3a524"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("line_sub", sa.String(255), nullable=True))
    op.create_unique_constraint("uq_users_line_sub", "users", ["line_sub"])


def downgrade() -> None:
    op.drop_constraint("uq_users_line_sub", "users", type_="unique")
    op.drop_column("users", "line_sub")
