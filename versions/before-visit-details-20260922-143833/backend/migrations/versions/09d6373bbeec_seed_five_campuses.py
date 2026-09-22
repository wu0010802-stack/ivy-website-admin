from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '09d6373bbeec'
down_revision: Union[str, None] = 'c2512c0bce3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAMPUSES = [
    ("yihua", "義華校"),
    ("minghua", "明華校"),
    ("chongde", "崇德校"),
    ("international", "國際校"),
    ("renwu", "仁武校"),
]

campuses_table = sa.table(
    "campuses",
    sa.column("key", sa.String),
    sa.column("name", sa.String),
    sa.column("active", sa.Boolean),
)


def upgrade() -> None:
    conn = op.get_bind()
    for key, name in CAMPUSES:
        conn.execute(
            sa.text(
                """
                INSERT INTO campuses (key, name, active)
                VALUES (:key, :name, true)
                ON CONFLICT (key) DO NOTHING
                """
            ),
            {"key": key, "name": name},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for key, _ in CAMPUSES:
        conn.execute(sa.text("DELETE FROM campuses WHERE key = :key"), {"key": key})
