"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "shops",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="general"),
        sa.Column("default_language", sa.String(10), nullable=False, server_default="od-IN"),
        sa.Column("catalog_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("settings", postgresql.JSONB, nullable=False, server_default="{}"),
        *_ts(),
    )
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("shop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shops.id"), nullable=False, index=True),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("pin_hash", sa.String(200), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="owner"),
        *_ts(),
    )
    op.create_table(
        "products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("shop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shops.id"), nullable=False, index=True),
        sa.Column("code", sa.String(16), nullable=False),
        sa.Column("sku", sa.String(64)),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("brand", sa.String(100), nullable=False, server_default=""),
        sa.Column("category", sa.String(50), nullable=False, server_default="general"),
        sa.Column("pack_unit", sa.String(20), nullable=False, server_default="piece"),
        sa.Column("sub_unit", sa.String(20), nullable=False, server_default="piece"),
        sa.Column("pack_size", sa.Numeric(12, 3), nullable=False, server_default="1"),
        sa.Column("sell_price", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("cost_price", sa.Numeric(12, 2)),
        sa.Column("stock_qty", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("low_stock_threshold", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("sold_count", sa.Integer, nullable=False, server_default="0"),
        *_ts(),
        sa.UniqueConstraint("shop_id", "name", "brand", name="uq_product_shop_name_brand"),
        sa.UniqueConstraint("shop_id", "code", name="uq_product_shop_code"),
    )
    op.create_table(
        "product_aliases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("alias", sa.String(200), nullable=False),
        sa.Column("lang", sa.String(10), nullable=False, server_default="mixed"),
        sa.Column("source", sa.String(20), nullable=False, server_default="seed"),
        sa.Column("hit_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        *_ts(),
        sa.UniqueConstraint("product_id", "alias", name="uq_alias_product_alias"),
    )
    op.create_table(
        "voice_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("shop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shops.id"), nullable=False, index=True),
        sa.Column("client_session_id", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="processing"),
        sa.Column("audio_path", sa.Text),
        sa.Column("mime_type", sa.String(80)),
        sa.Column("duration_ms", sa.Integer),
        sa.Column("speech_ms", sa.Integer),
        sa.Column("chunks_json", postgresql.JSONB),
        sa.Column("sarvam_transcript", sa.Text),
        sa.Column("sarvam_meta", postgresql.JSONB),
        sa.Column("saaras_translation", sa.Text),
        sa.Column("saaras_codemix", sa.Text),
        sa.Column("google_transcript", sa.Text),
        sa.Column("google_meta", postgresql.JSONB),
        sa.Column("llm_request_id", sa.String(80)),
        sa.Column("llm_model", sa.String(60)),
        sa.Column("llm_output_json", postgresql.JSONB),
        sa.Column("final_json", postgresql.JSONB),
        sa.Column("latencies", postgresql.JSONB),
        sa.Column("token_usage", postgresql.JSONB),
        sa.Column("error", sa.Text),
        *_ts(),
        sa.UniqueConstraint("shop_id", "client_session_id", name="uq_voice_session_client"),
    )
    op.create_table(
        "transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("shop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shops.id"), nullable=False, index=True),
        sa.Column("voice_session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("voice_sessions.id")),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("customer_name", sa.String(200)),
        sa.Column("payment_mode", sa.String(20), nullable=False, server_default="cash"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="saved"),
        sa.Column("notes", sa.Text),
        *_ts(),
    )
    op.create_table(
        "transaction_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("qty", sa.Numeric(12, 3), nullable=False),
        sa.Column("unit", sa.String(20), nullable=False),
        sa.Column("qty_base", sa.Numeric(12, 3), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("spoken_span", sa.Text),
        sa.Column("llm_confidence", sa.Numeric(4, 3)),
        sa.Column("was_corrected", sa.Boolean, nullable=False, server_default=sa.false()),
        *_ts(),
    )
    op.create_table(
        "stock_ledger",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("shop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shops.id"), nullable=False, index=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("delta_qty", sa.Numeric(12, 3), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("ref_type", sa.String(30)),
        sa.Column("ref_id", postgresql.UUID(as_uuid=True)),
        sa.Column("balance_after", sa.Numeric(12, 3), nullable=False),
        sa.Column("note", sa.Text),
        *_ts(),
    )
    op.create_index("ix_stock_ledger_product_created", "stock_ledger", ["product_id", "created_at"])
    op.create_table(
        "corrections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("voice_session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("voice_sessions.id"),
                  nullable=False, index=True),
        sa.Column("shop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shops.id"), nullable=False, index=True),
        sa.Column("item_index", sa.Integer, nullable=False),
        sa.Column("spoken_span", sa.Text),
        sa.Column("llm_product_code", sa.String(16)),
        sa.Column("llm_confidence", sa.Numeric(4, 3)),
        sa.Column("final_product_code", sa.String(16)),
        sa.Column("field", sa.String(20), nullable=False),
        sa.Column("old_value", postgresql.JSONB),
        sa.Column("new_value", postgresql.JSONB),
        *_ts(),
    )


def downgrade() -> None:
    for t in ["corrections", "stock_ledger", "transaction_items", "transactions", "voice_sessions",
              "product_aliases", "products", "users", "shops"]:
        op.drop_table(t)
