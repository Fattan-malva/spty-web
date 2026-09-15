import asyncio

SEARCH_LOCKS: dict[str, asyncio.Lock] = {}
SEARCH_LOCKS_GUARD = asyncio.Lock()
TOKEN_LOCKS: dict[str, asyncio.Lock] = {}
CLIENT_TOKEN_LOCKS: dict[str, asyncio.Lock] = {}
TOKEN_LOCKS_GUARD = asyncio.Lock()
CLIENT_TOKEN_LOCKS_GUARD = asyncio.Lock()


async def get_search_lock(key: str) -> asyncio.Lock:
    async with SEARCH_LOCKS_GUARD:
        lock = SEARCH_LOCKS.get(key)
        if lock is None:
            lock = asyncio.Lock()
            SEARCH_LOCKS[key] = lock
        return lock


async def get_token_lock(key: str) -> asyncio.Lock:
    async with TOKEN_LOCKS_GUARD:
        lock = TOKEN_LOCKS.get(key)
        if lock is None:
            lock = asyncio.Lock()
            TOKEN_LOCKS[key] = lock
        return lock


async def get_client_token_lock(key: str) -> asyncio.Lock:
    async with CLIENT_TOKEN_LOCKS_GUARD:
        lock = CLIENT_TOKEN_LOCKS.get(key)
        if lock is None:
            lock = asyncio.Lock()
            CLIENT_TOKEN_LOCKS[key] = lock
        return lock