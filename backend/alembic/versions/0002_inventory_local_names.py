"""inventory intake + local product names

Revision ID: 0002_inventory_local_names
Revises: 0001_initial
Create Date: 2026-09-12
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_inventory_local_names"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

_RANGES = {"od": (0x0B00, 0x0B7F), "hi": (0x0900, 0x097F), "mr": (0x0900, 0x097F), "bn": (0x0980, 0x09FF),
           "pa": (0x0A00, 0x0A7F), "gu": (0x0A80, 0x0AFF), "ta": (0x0B80, 0x0BFF), "te": (0x0C00, 0x0C7F),
           "kn": (0x0C80, 0x0CFF), "ml": (0x0D00, 0x0D7F)}


def _local(aliases, language):
    rng = _RANGES.get((language or "od-IN").split("-")[0].lower())
    if not rng:
        return None
    for a in aliases:
        letters = [c for c in a if not c.isspace()]
        if letters and sum(rng[0] <= ord(c) <= rng[1] for c in letters) / len(letters) >= 0.6:
            return a[:200]
    return None


def upgrade() -> None:
    op.add_column("products", sa.Column("local_name", sa.String(200), nullable=True))
    op.add_column("voice_sessions", sa.Column("input_mode", sa.String(20), nullable=False, server_default="sale"))
    bind = op.get_bind()
    rows = bind.execute(sa.text("""
        select p.id, s.default_language, a.alias
        from products p join shops s on s.id = p.shop_id
        left join product_aliases a on a.product_id = p.id and a.source = 'seed'
        order by p.id, a.created_at, a.alias""")).fetchall()
    grouped: dict = {}
    for pid, lang, alias in rows:
        entry = grouped.setdefault(pid, (lang, []))
        if alias:
            entry[1].append(alias)
    for pid, (lang, aliases) in grouped.items():
        name = _local(aliases, lang)
        if name:
            bind.execute(sa.text("update products set local_name = :n where id = :i"), {"n": name, "i": pid})


def downgrade() -> None:
    op.drop_column("voice_sessions", "input_mode")
    op.drop_column("products", "local_name")
