"""photographed lists: one sessions table for both input kinds

A scan reuses voice_sessions so the review screen, corrections and alias learning are shared. Only the
produced text differs in origin, so this adds input_kind plus the reader's output. There is no
image path column on purpose: photos are read in memory and never stored (KEEP_IMAGES).

Revision ID: 0005_image_capture
Revises: 0004_single_unit
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_image_capture"
down_revision = "0004_single_unit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("voice_sessions", sa.Column("input_kind", sa.String(10), nullable=False,
                                              server_default="voice"))
    op.add_column("voice_sessions", sa.Column("image_count", sa.Integer(), nullable=True))
    op.add_column("voice_sessions", sa.Column("ocr_text", sa.Text(), nullable=True))
    op.add_column("voice_sessions", sa.Column("ocr_meta", postgresql.JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("voice_sessions", "ocr_meta")
    op.drop_column("voice_sessions", "ocr_text")
    op.drop_column("voice_sessions", "image_count")
    op.drop_column("voice_sessions", "input_kind")
