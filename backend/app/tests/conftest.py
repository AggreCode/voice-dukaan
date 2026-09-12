import os

import pytest
from sqlalchemy import text

os.environ.setdefault("SARVAM_API_KEY", "test")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")
os.environ.setdefault("GEMINI_API_KEY", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://vd:vd@localhost:5433/voicedukan")


@pytest.fixture(autouse=True)
async def _fresh_engine():
    """pytest-asyncio gives each test its own loop; asyncpg pools are loop-bound, so rebuild the engine."""
    import app.db as db

    db._engine = None
    db._sessionmaker = None
    yield
    if db._engine is not None:
        # remove everything the test shops created (no delete endpoint by design)
        try:
            async with db.get_engine().begin() as conn:
                await conn.execute(text("""
                    with s as (select id from shops where name like 't-%' or name = 'silent')
                    delete from corrections where shop_id in (select id from s)"""))
                for tbl in ("stock_ledger", "transaction_items", "transactions", "voice_sessions",
                            "product_aliases", "products", "users", "shops"):
                    sub = "transaction_id in (select id from transactions where shop_id in (select id from s))" \
                        if tbl == "transaction_items" else \
                        "product_id in (select id from products where shop_id in (select id from s))" \
                        if tbl == "product_aliases" else \
                        "id in (select id from s)" if tbl == "shops" else "shop_id in (select id from s)"
                    await conn.execute(text(
                        f"with s as (select id from shops where name like 't-%' or name = 'silent') "
                        f"delete from {tbl} where {sub}"))
        except Exception:  # noqa: BLE001
            pass
        await db._engine.dispose()
        db._engine = None
        db._sessionmaker = None

