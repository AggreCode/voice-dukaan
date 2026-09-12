"""A pasted hosted-Postgres URL must work unedited: wrong driver or stray parameters would only fail
at the first connection, minutes into a deploy."""
import pytest

from app.config import Settings

NEON = ("postgresql://vd:pw@ep-cool-1.ap-southeast-1.aws.neon.tech/neondb"
        "?sslmode=require&channel_binding=require")


@pytest.mark.parametrize(("given", "expected"), [
    (NEON, "postgresql+asyncpg://vd:pw@ep-cool-1.ap-southeast-1.aws.neon.tech/neondb?ssl=require"),
    ("postgres://u:p@host/db?sslmode=verify-full", "postgresql+asyncpg://u:p@host/db?ssl=require"),
    ("postgresql+asyncpg://u:p@host/db?ssl=require", "postgresql+asyncpg://u:p@host/db?ssl=require"),
    ("postgresql+asyncpg://vd:vd@localhost:5433/voicedukan", "postgresql+asyncpg://vd:vd@localhost:5433/voicedukan"),
    ("postgresql://u:p@host/db?channel_binding=require", "postgresql+asyncpg://u:p@host/db"),
])
def test_database_url_is_normalised(given, expected):
    assert Settings(DATABASE_URL=given).DATABASE_URL == expected
