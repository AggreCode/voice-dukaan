"""collapse pack_unit/sub_unit/pack_size into one free-text unit

A product now has exactly one unit, chosen by the shop -- no pack/sub-unit conversion. Existing
stock_qty was already stored in sub_unit terms, so it is kept unchanged and `unit` becomes sub_unit.
sell_price and cost_price were "per pack_unit"; where pack_size differed from 1 they are divided down
to "per unit" so the economics of existing test data are not silently multiplied by pack_size.

Revision ID: 0004_single_unit
Revises: 0003_clean_learned_aliases
Create Date: 2026-09-12
"""
import sqlalchemy as sa
from alembic import op

revision = "0004_single_unit"
down_revision = "0003_clean_learned_aliases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("unit", sa.String(30), nullable=True))
    op.execute(sa.text("""
        update products set
            unit = sub_unit,
            sell_price = case when pack_size > 0 then round(sell_price / pack_size, 2) else sell_price end,
            cost_price = case when cost_price is not null and pack_size > 0
                              then round(cost_price / pack_size, 2) else cost_price end
    """))
    op.alter_column("products", "unit", nullable=False, server_default="piece")
    op.drop_column("products", "pack_unit")
    op.drop_column("products", "sub_unit")
    op.drop_column("products", "pack_size")


def downgrade() -> None:
    op.add_column("products", sa.Column("pack_unit", sa.String(20), nullable=False, server_default="piece"))
    op.add_column("products", sa.Column("sub_unit", sa.String(20), nullable=False, server_default="piece"))
    op.add_column("products", sa.Column("pack_size", sa.Numeric(12, 3), nullable=False, server_default="1"))
    op.execute(sa.text("update products set pack_unit = unit, sub_unit = unit, pack_size = 1"))
    op.drop_column("products", "unit")
