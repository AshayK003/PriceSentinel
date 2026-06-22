"""Routers for change detection results."""
import time
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from models import get_db, DiffResult, WatchedPage, PageSnapshot
from schemas import ChangeResponse

router = APIRouter(prefix="/changes", tags=["changes"])

# ── Simple in-memory cache (dict + timestamp beats a decorator
#    for FastAPI routes where the Session object isn't hashable) ──
_unread_cache: tuple[float, dict] | None = None  # (timestamp, data)
_UNREAD_TTL = 30  # seconds


def _invalidate_cache():
    """Call after any write that changes diff counts."""
    global _unread_cache
    _unread_cache = None


@router.get("", response_model=list[ChangeResponse])
async def get_changes(
    url: str = Query(...),
    limit: int = Query(default=10, le=50),
    truncate: int | None = Query(default=None, ge=20, le=500, description="Max chars per diff text segment"),
    db: Session = Depends(get_db),
):
    page = db.query(WatchedPage).filter(WatchedPage.url == url).first()
    if not page:
        return []
    diffs = (
        db.query(DiffResult)
        .filter(DiffResult.page_id == page.id)
        .order_by(DiffResult.created_at.desc())
        .limit(limit)
        .all()
    )
    result = []
    for d in diffs:
        diff = d.diff_json or []  # guard against NULL in DB
        if truncate and diff:
            diff = [
                {**seg, "text": seg["text"][:truncate]}
                if len(seg["text"]) > truncate
                else seg
                for seg in diff
            ]
        result.append(
            ChangeResponse(
                id=d.id,
                page_id=d.page_id,
                summary=d.summary,
                diff=diff,
                created_at=d.created_at,
            )
        )
    return result


@router.get("/unread-count")
async def unread_counts(db: Session = Depends(get_db)):
    """Return count of changes + last poll time per watched page.

    Returns ALL watched pages (not just those with changes) so the
    frontend can show "checked X ago" even for pages with 0 changes.

    PERFORMANCE: 2 GROUP BY subqueries + outer joins (1 roundtrip).
                 Cached for 30s to survive rapid popup opens.
    """
    global _unread_cache
    now = time.monotonic()

    # Stale-while-revalidate: return cached data immediately if fresh
    if _unread_cache and (now - _unread_cache[0]) < _UNREAD_TTL:
        return _unread_cache[1]

    # Subquery A: diff count per page
    sub = (
        db.query(
            DiffResult.page_id,
            func.count(DiffResult.id).label("cnt"),
        )
        .group_by(DiffResult.page_id)
        .subquery()
    )

    # Subquery B: most recent poll timestamp per page
    last_poll_sub = (
        db.query(
            PageSnapshot.page_id,
            func.max(PageSnapshot.fetched_at).label("last_poll"),
        )
        .group_by(PageSnapshot.page_id)
        .subquery()
    )

    rows = (
        db.query(WatchedPage.url, sub.c.cnt, last_poll_sub.c.last_poll)
        .outerjoin(sub, WatchedPage.id == sub.c.page_id)
        .outerjoin(last_poll_sub, WatchedPage.id == last_poll_sub.c.page_id)
        .all()
    )

    result = {
        url: {
            "changes": cnt or 0,
            "last_checked": last_poll.isoformat() if last_poll else None,
        }
        for url, cnt, last_poll in rows
    }

    _unread_cache = (now, result)
    return result


# ── Wire cache invalidation into the poll worker ──
# Imported by poll.py after commit to keep unread-count fresh.
def invalidate_unread_cache():
    _invalidate_cache()
