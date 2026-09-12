"""drop learned aliases that carry quantities or shadow another product

Corrections used to store the whole spoken line, so "2 packet biscuit" became an alias. Those never
match a later bill and, once fed back as speech hints, actively caused mis-hearings.

Revision ID: 0003_clean_learned_aliases
Revises: 0002_inventory_local_names
Create Date: 2026-09-12
"""
import sqlalchemy as sa
from alembic import op

revision = "0003_clean_learned_aliases"
down_revision = "0002_inventory_local_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        delete from product_aliases a
        using products p
        where a.product_id = p.id
          and a.source = 'user_correction'
          and (a.alias ~ '[0-9]'
               or exists (select 1 from products o
                          where o.shop_id = p.shop_id and o.id <> p.id
                            and (lower(o.name) = lower(a.alias) or lower(o.name) like lower(a.alias) || ' %')))
    """))


def downgrade() -> None:
    pass  # deleted learning cannot be restored, and should not be
