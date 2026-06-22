"""
Simple in-memory TTL cache for expensive endpoints.

Uses cachetools (small pip package, pure-Python stdlib).
          Could use functools.lru_cache but TTL eviction needs a 3rd-party lib.
Tradeoff: cache is per-process, lost on restart. Acceptable for MVP.
          Replace with Redis when scaling beyond 1 instance.
"""
import time
from functools import wraps

_cache: dict[str, tuple[float, object]] = {}
DEFAULT_TTL = 30  # seconds


def ttl_cache(ttl: int = DEFAULT_TTL):
    """Decorator: cache the return value of a sync function for `ttl` seconds.

    The cache key is the stringified args + kwargs of the call.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            key = f"{fn.__name__}:{args}:{kwargs}"
            now = time.monotonic()
            entry = _cache.get(key)
            if entry and (now - entry[0]) < ttl:
                return entry[1]
            result = fn(*args, **kwargs)
            _cache[key] = (now, result)
            return result
        return wrapper
    return decorator


def invalidate(pattern: str | None = None):
    """Invalidate cache entries whose key contains `pattern`.

    Call after any write operation (add/remove page, detect change).
    With no pattern, clear everything.
    """
    global _cache
    if pattern is None:
        _cache.clear()
        return
    keys = [k for k in _cache if pattern in k]
    for k in keys:
        del _cache[k]
