"""API contract tests — every endpoint + error path."""

from models import WatchedPage, PageSnapshot, DiffResult


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_add_page(client):
    resp = client.post("/pages", json={"url": "https://example.com/pricing", "title": "Example"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["url"] == "https://example.com/pricing"
    assert "id" in data


def test_add_page_duplicate(client):
    client.post("/pages", json={"url": "https://example.com/pricing"})
    resp = client.post("/pages", json={"url": "https://example.com/pricing"})
    assert resp.status_code == 400
    assert "already" in resp.json()["detail"].lower()


def test_add_page_empty_body(client):
    resp = client.post("/pages", json={})
    assert resp.status_code == 422  # validation error


def test_list_pages(client):
    client.post("/pages", json={"url": "https://a.com", "title": "A"})
    client.post("/pages", json={"url": "https://b.com", "title": "B"})
    resp = client.get("/pages")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["url"] == "https://a.com"


def test_list_pages_empty(client):
    resp = client.get("/pages")
    assert resp.status_code == 200
    assert resp.json() == []


def test_delete_page(client):
    client.post("/pages", json={"url": "https://example.com/pricing"})
    resp = client.delete("/pages", params={"url": "https://example.com/pricing"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    # Verify gone
    resp = client.get("/pages")
    assert resp.json() == []


def test_delete_page_not_found(client):
    resp = client.delete("/pages", params={"url": "https://example.com/nonexistent"})
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_get_changes_empty(client):
    """Changes for a page that exists but has no diffs → empty list."""
    client.post("/pages", json={"url": "https://example.com/pricing"})
    resp = client.get("/changes", params={"url": "https://example.com/pricing"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_changes_unwatched_page(client):
    """Changes for a URL that isn't watched → empty list (not 404)."""
    resp = client.get("/changes", params={"url": "https://example.com/unknown"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_changes_with_data(client, db):
    """Seed a page + diff, verify it's returned."""
    page = WatchedPage(url="https://example.com/pricing", title="Pricing")
    db.add(page)
    db.commit()

    snap1 = PageSnapshot(page_id=page.id, html="old")
    snap2 = PageSnapshot(page_id=page.id, html="new")
    db.add(snap1)
    db.add(snap2)
    db.commit()

    diff = DiffResult(
        page_id=page.id,
        snapshot_id=snap2.id,
        prev_snapshot_id=snap1.id,
        diff_json=[{"type": "added", "text": "new"}],
        summary="Price changed",
    )
    db.add(diff)
    db.commit()

    resp = client.get("/changes", params={"url": "https://example.com/pricing"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["summary"] == "Price changed"
    assert data[0]["diff"] == [{"type": "added", "text": "new"}]


def test_unread_counts(client, db):
    """All pages appear in unread-count with changes + last_checked."""
    page_a = WatchedPage(url="https://a.com", title="A")
    page_b = WatchedPage(url="https://b.com", title="B")
    db.add(page_a)
    db.add(page_b)
    db.commit()

    snap = PageSnapshot(page_id=page_a.id, html="x")
    db.add(snap)
    db.commit()

    diff = DiffResult(page_id=page_a.id, snapshot_id=snap.id, diff_json=[], summary="change")
    db.add(diff)
    db.commit()

    resp = client.get("/changes/unread-count")
    assert resp.status_code == 200
    data = resp.json()
    # Page A: has 1 diff + 1 snapshot -> changes=1, last_checked set
    assert data["https://a.com"]["changes"] == 1
    assert data["https://a.com"]["last_checked"] is not None
    # Page B: 0 diffs, 0 snapshots -> changes=0, last_checked=None
    assert data["https://b.com"]["changes"] == 0
    assert data["https://b.com"]["last_checked"] is None


def test_trigger_poll(client, db):
    """POST /pages/poll triggers a poll cycle."""
    page = WatchedPage(url="https://example.com/pricing", title="Pricing")
    db.add(page)
    db.commit()

    resp = client.post("/pages/poll", params={"url": "https://example.com/pricing"})
    # Poll runs async in background; we just check the endpoint returns ok
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_trigger_poll_unwatched(client):
    """POST /pages/poll for an unwatched URL → 404."""
    resp = client.post("/pages/poll", params={"url": "https://example.com/nonexistent"})
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_alerts_crud(client):
    """Create and list alert configs."""
    resp = client.post("/alerts", json={"email": "test@example.com", "slack_webhook": ""})
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "test@example.com"

    resp = client.get("/alerts")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1
