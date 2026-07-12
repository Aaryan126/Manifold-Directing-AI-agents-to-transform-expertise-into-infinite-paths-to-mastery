import asyncio
from pathlib import Path

from app.config import get_settings
from app.db.migrations import run_migrations


async def main() -> None:
    await run_migrations(get_settings().database_url, Path("migrations"))


if __name__ == "__main__":
    asyncio.run(main())
