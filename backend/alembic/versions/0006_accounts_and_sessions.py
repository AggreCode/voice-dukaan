"""username + password logins, shop registration details, and revocable sessions

Replaces the header-and-PIN arrangement, where any caller could name any shop id and be believed.
Passwords are scrypt hashes (services/passwords.py); sessions are rows so signing out actually ends
the session rather than asking the browser to forget it.

Revision ID: 0006_accounts_and_sessions
Revises: 0005_image_capture
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006_accounts_and_sessions"
down_revision = "0005_image_capture"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shops", sa.Column("gst_number", sa.String(20), nullable=True))
    op.add_column("shops", sa.Column("mobile", sa.String(20), nullable=True))
    op.add_column("shops", sa.Column("whatsapp", sa.String(20), nullable=True))
    op.add_column("shops", sa.Column("address", sa.String(500), nullable=True))

    op.add_column("users", sa.Column("username", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("mobile", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_mobile", "users", ["mobile"])
    # Shops created before logins existed have no PIN either; keep the column but stop requiring it.
    op.alter_column("users", "pin_hash", nullable=True, server_default="")

    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("shops.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_index("ix_sessions_shop_id", "sessions", ["shop_id"])
    op.create_index("ix_sessions_token_hash", "sessions", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_table("sessions")
    op.drop_index("ix_users_mobile", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "mobile")
    op.drop_column("users", "password_hash")
    op.drop_column("users", "username")
    for col in ("address", "whatsapp", "mobile", "gst_number"):
        op.drop_column("shops", col)
