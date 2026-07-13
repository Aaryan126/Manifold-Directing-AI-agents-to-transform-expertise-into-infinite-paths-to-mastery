import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from psycopg.rows import RowFactory
from psycopg_pool import AsyncConnectionPool

_pools: dict[tuple[str, object | None], AsyncConnectionPool[Any]] = {}
_pool_lock = asyncio.Lock()


@asynccontextmanager
async def pooled_connection(
    database_url: str,
    *,
    row_factory: RowFactory[Any] | None = None,
) -> AsyncIterator[Any]:
    pool = await _get_pool(database_url, row_factory)
    async with pool.connection() as conn:
        yield conn


async def close_connection_pools() -> None:
    async with _pool_lock:
        pools = list(_pools.values())
        _pools.clear()
    await asyncio.gather(*(pool.close() for pool in pools))


async def _get_pool(
    database_url: str,
    row_factory: RowFactory[Any] | None,
) -> AsyncConnectionPool[Any]:
    key = (database_url, row_factory)
    pool = _pools.get(key)
    if pool is not None:
        return pool
    async with _pool_lock:
        pool = _pools.get(key)
        if pool is None:
            kwargs = {"row_factory": row_factory} if row_factory is not None else None
            pool = AsyncConnectionPool(
                database_url,
                min_size=5,
                max_size=30,
                kwargs=kwargs,
                open=False,
            )
            await pool.open()
            await pool.wait()
            _pools[key] = pool
        return pool
