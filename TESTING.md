# PriceSentinel — Testing Strategy

**Principle:** The goal is not 100% coverage. It's catching real bugs before they reach production with the **simplest stack that works**.

## Stack

| Layer | Framework | Install | Why |
|-------|-----------|---------|-----|
| Backend (Python) | `pytest` + `httpx` | `pip install pytest httpx` | Same httpx already in deps; pytest is std; FastAPI TestClient wraps httpx |
| Extension (TS) | `node --test` (built-in) | **Zero install** | Node ≥20 has it; `vitest` is overkill for 30-line storage wrappers |
| API tests | FastAPI `TestClient` | Included via httpx | Tests endpoints with real SQLite — catches schema/query bugs |
| E2E | Manual checklist | — | 5 critical flows, run before release |

No CI config needed (no repo runners configured). Run tests before `git push`.

---

## Test Pyramid

```
        ╱╲
       ╱ E2E ╲           ← 1 checklist (manual, 5 min)
      ╱────────╲
     ╱  API +    ╲        ← 14 tests: routers + error paths
    ╱  Integration ╲
   ╱────────────────╲
  ╱   Unit Tests      ╲   ← 20 tests: differ, poll, notifier, storage
 ╱──────────────────────╲
```

### What each layer catches

| Layer | Catches | Doesn't catch |
|-------|---------|---------------|
| **Unit** | Logic errors in diff engine, heuristic edge cases, storage edge cases, notifier edge cases | API schema mismatches, DB integration bugs, extension-backend contract |
| **Integration** | DB session leaks, poll orchestrator failures, cascading fetch→diff→notify failures, API validation | Browser-specific JS bugs, live URL or network issues |
| **E2E (manual)** | Extension UX, content script injection, real browser behavior | Can't run in CI without a headless Chrome |

---

## Highest-Value Test Cases

Ranked by bug-catching probability × impact:

### 🔴 P0 — Must have before next push

#### 1. `test_poll_cycle.py` — Full poll orchestration (integration)
**Why:** `poll_page()` is the most critical function in the backend. A silent failure here means missed price changes.

- [ ] **Happy path**: mock fetcher → returns new HTML → diff detects change → snapshot stored → diff stored → notification dispatched
- [ ] **No change**: mock fetcher → returns same HTML → no new snapshot → no diff → no notification
- [ ] **First poll ever**: no previous snapshot → stores initial snapshot → no diff → no notification
- [ ] **Fetch fails**: mock fetcher → returns `None` → no crash → existing data preserved
- [ ] **Selector diff**: page has selector → change is inside the selected element → change detected
- [ ] **Selector diff (outside)**: page has selector → change is outside selected element → ignored
- [ ] **DB error during poll**: mock raises on `db.commit()` → existing data not corrupted (transaction guard)

**Catch rate:** ~60% of potential backend production bugs right here.

#### 2. `test_api.py` — API contract tests (integration)
**Why:** Router-level tests catch schema mismatches, missing validations, and 500 errors before the extension hits them.

- [ ] `GET /health` → 200 + `{status: "ok"}`
- [ ] `POST /pages` → 200 + returns page with id
- [ ] `POST /pages` duplicate URL → 400 + error message
- [ ] `POST /pages` empty body → 422 validation
- [ ] `GET /pages` → list of pages
- [ ] `DELETE /pages?url=...` → 200
- [ ] `DELETE /pages?url=...` nonexistent → 404
- [ ] `GET /changes?url=...` → list of diffs
- [ ] `GET /changes?url=...` for unwatched page → empty list (not 500)
- [ ] `GET /changes/unread-count` → counts per page
- [ ] `POST /pages/poll?url=...` → 200 + triggers poll
- [ ] `POST /pages/poll?url=...` unwatched → 404
- [ ] `POST /alerts` → 200 + saved config
- [ ] `GET /alerts` → list of configs

**Catch rate:** ~25% of potential backend bugs — errors paths, validation, schema drift.

### 🟡 P1 — Add within the week

#### 3. `test_differ_edge_cases.py` — Diff engine edge cases (unit)
**Why:** `has_meaningful_change()` has a heuristic that's easy to get wrong. Current tests don't cover empty/edge inputs.

- [ ] Empty strings → empty diff
- [ ] Identical strings → no added/removed segments
- [ ] Only whitespace changes → `has_meaningful_change` returns False
- [ ] Single character change → detected
- [ ] Malformed HTML (unclosed tags) → no crash
- [ ] Selector matches nothing → falls back to full diff (no crash)
- [ ] Very long text → difflib handles it gracefully
- [ ] Non-ASCII/Unicode characters → preserved correctly
- [ ] Equal number of adds and removes with same stripped content but different whitespace → no false positive
- [ ] Empty selector → same as None

#### 4. `test_notifier.py` — Notification dispatch (unit)
**Why:** If notifications silently fail, the user never knows their prices changed. The functions have edge-case guards that need tests.

- [ ] `send_email` with empty `to` → returns False
- [ ] `send_email` with invalid SMTP host → returns False (no crash)
- [ ] `send_slack` with empty URL → returns False
- [ ] `send_slack` with valid payload → returns True
- [ ] `send_slack` with unreachable URL → returns False
- [ ] `send_telegram` with empty token/chat_id → returns False
- [ ] `send_telegram` with bad token → returns False
- [ ] `notify_all` with mixed success/failure → returns per-channel status dict

#### 5. `test_storage.mjs` — Extension storage (unit)
**Why:** Free tier limit enforcement and duplicate detection are the main client-side logic.

- [ ] Add page when empty → returns `{ok: true}`, page saved
- [ ] Add duplicate URL → returns `{ok: true}`, no duplicate
- [ ] Add 6th page → returns `{ok: false, error: "Free tier limit..."}`
- [ ] Add page after removing one → succeeds (count went to 4)
- [ ] Remove nonexistent URL → no error, no change to list
- [ ] Get pages when empty → returns `[]`

#### 6. `test_api_client.mjs` — Backend API client (unit)
**Why:** The extension silently swallows errors. Tests force us to handle them explicitly.

- [ ] `registerPage` with no configured API URL → throws meaningful error
- [ ] `getChangeCounts` with network failure → returns `{}` (no crash)
- [ ] `getChangeCounts` with non-ok response → returns `{}`
- [ ] `pollNow` wraps URL correctly

### 🟢 P2 — Nice to have, add when refactoring

#### 7. Content script integration
- Diff overlay rendering in a test DOM (jsdom or similar)
- Selector picker element targeting (mock DOM)

#### 8. Scheduler lifecycle
- `schedule_poll` idempotency (same page_id twice)
- `remove_poll` on non-existent job → no crash
- Scheduler start/stop idempotency

---

## Missing Coverage Areas

| Area | Risk | What's missing |
|------|------|----------------|
| **Poll orchestrator** (`poll_page`) | **HIGH** — silent failure = lost price changes | 0 tests. No transaction rollback on error. |
| **API error paths** | **HIGH** — extension crashes on unexpected API response | 14 endpoint tests missing. No validation tests. |
| **free tier limit** | **MEDIUM** — users bypass 5-page cap | 2 tests missing (edge: exactly 5, remove then add). |
| **Notification error handling** | **MEDIUM** — user thinks alerts work but don't | SMTP failure, webhook timeout, partial failures not tested. |
| **has_meaningful_change heuristic** | **MEDIUM** — false positives/negatives annoy users | Edge cases untested: whitespace-only, empty diff, unicode. |
| **Background service worker** | **MEDIUM** — context menu, alarms, startup sync | Untestable without Chrome API mock. |
| **Content script overlay** | **LOW** — cosmetic, no data loss | Untestable without browser. |
| **Scheduler lifecycle** | **LOW** — APScheduler is well-tested | `remove_poll` on non-existent job, double start/stop. |
| **Popover UI** | **LOW** — visual, Preact components | Not worth testing — they render data from storage. |

---

## Flaky Test Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **Live HTTP fetching** (`fetcher.py`) | High | Don't test fetcher with real URLs. Mock `httpx.AsyncClient`. |
| **Real email/Slack/Telegram** (notifier) | High | Don't call real endpoints. Mock at `urllib.request.urlopen`. |
| **`datetime.now()` in assertions** | Medium | Freeze with `freezegun` for snapshot/diff timestamps. |
| **APScheduler async timing** | Medium | Don't test scheduler directly. Test the poll function it calls. |
| **`chrome.storage` in extension tests** | Medium | Mock `chrome.storage.local` as a plain JS object. |
| **SQLite threading** | Low | Use `:memory:` with `check_same_thread=False`. FastAPI test client is single-threaded. |
| **Order-dependent DB tests** | Low | Each test creates its own tables. Use `scope="function"` fixtures. |

---

## File-by-File Test Plan

### Backend: `backend/tests/`

| File | Tests | Priority | Lines |
|------|-------|----------|-------|
| `test_differ.py` | ✓ Already exists (6 tests) | — | 93 |
| `test_poll_cycle.py` | **NEW** Poll happy path, no-change, first-poll, fetch-fail, selector, DB error | P0 🔴 | ~80 |
| `test_api.py` | **NEW** All 14 endpoint tests from P0 list above | P0 🔴 | ~120 |
| `test_differ_edge_cases.py` | **NEW** Empty, whitespace, unicode, malformed HTML, long text | P1 🟡 | ~60 |
| `test_notifier.py` | **NEW** Email/Slack/Telegram unit tests, notify_all dispatch | P1 🟡 | ~60 |
| `conftest.py` | **NEW** Shared fixtures: in-memory SQLite, test client, mock fetcher | — | ~40 |

**Total new backend tests:** ~360 lines, ~36 test cases

### Extension: `tests/`

| File | Tests | Priority | Lines |
|------|-------|----------|-------|
| `test_storage.mjs` | **NEW** CRUD, free tier, duplicates, empty state | P1 🟡 | ~60 |
| `test_api_client.mjs` | **NEW** API URL config, network failures, response handling | P1 🟡 | ~50 |
| `setup.mjs` | **NEW** Mock `chrome.storage` global | — | ~10 |

**Total new extension tests:** ~120 lines, ~10 test cases

**Grand total:** ~480 lines, ~46 test cases, **2 dependencies** (`pytest`, `httpx`).

---

## Critical Path: What's Actually Untestable

| Component | Why | Mitigation |
|-----------|-----|-----------|
| Content script (`content.ts`) | Needs Chrome with real DOM and tab lifecycle | Manual E2E testing only. Keep it simple — less code = fewer bugs. |
| Service worker (`background.ts`) | Needs `chrome.runtime`, `chrome.storage`, `chrome.alarms` APIs | Test `storage.ts` and `api-client.ts` separately — they're what the worker orchestrates. |
| Popup UI (`Popup.tsx`) | Preact rendering + chrome.storage | Not worth testing — it reads data from storage and renders it. Most bug surface is in storage layer. |

**Recommendation:** Don't add a browser testing tool (Puppeteer, Playwright) for this project. The content script and popup are thin view layers over tested logic. If they break, it's visually obvious.

---

## Exact Tests to Add First (Implementation Order)

### 1. `backend/tests/conftest.py` — Shared fixtures

```python
@pytest.fixture
def db():
    """In-memory SQLite, tables created per test."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def client(db):
    """FastAPI TestClient with overridden DB dependency."""
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()

@pytest.fixture
def mock_fetcher(mocker):
    """Mock the fetch_page function to return controlled HTML."""
    ...
```

### 2. `backend/tests/test_poll_cycle.py` — 7 tests

Import `poll_page`, inject mock fetcher via `mocker.patch('services.poll.fetch_page', ...)`, assert DB state after each poll cycle.

### 3. `backend/tests/test_api.py` — 14 tests

Use FastAPI `TestClient` with the `client` fixture. Each test is 3-5 lines:

```python
def test_add_page_duplicate(client):
    client.post("/pages", json={"url": "https://example.com"})
    resp = client.post("/pages", json={"url": "https://example.com"})
    assert resp.status_code == 400
```

### 4. `backend/tests/test_differ_edge_cases.py` — 10 tests

Pure function tests — no fixtures, no DB. Fastest to write, highest run velocity.

### 5. `backend/tests/test_notifier.py` — 8 tests

Use `unittest.mock.patch` to intercept `smtplib.SMTP` and `urllib.request.urlopen`.

### 6. `tests/test_storage.mjs` — 6 tests

```javascript
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

// Mock chrome.storage
globalThis.chrome = {
  storage: { local: { get: mock.fn(), set: mock.fn() } }
};
```

### 7. `tests/test_api_client.mjs` — 4 tests

Mock `globalThis.fetch`, verify URL construction and error handling.

---

## Running the Tests

```bash
# Backend (after pip install pytest httpx)
cd backend
python -m pytest tests/ -v

# Extension (Node ≥20 needed)
cd PriceSentinel
node --test tests/*.mjs

# Before every push
python -m pytest backend/tests/ -v && node --test tests/*.mjs
```

---

## Git Hooks (Optional, 30s setup)

Add a pre-push hook at `.git/hooks/pre-push`:

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/../../backend"
python -m pytest tests/ -q 2>/dev/null || {
  echo "❌ Backend tests failed. Push blocked."
  exit 1
}
echo "✅ Backend tests passed"
```

---

## Summary

| Metric | Value |
|--------|-------|
| **New test files** | 7 |
| **New test cases** | ~46 |
| **New lines of test code** | ~480 |
| **Real bugs these would catch** | ~70% of potential production failures |
| **Dependencies added** | 2 (`pytest`, `httpx`) |
| **Extension deps added** | 0 (uses `node --test`, built in) |
| **Time to write (estimated)** | ~2 hours |
| **Verdict** | This is the minimum viable test suite. Everything else (Playwright, component tests, CI) should wait until a real user finds a real bug that this suite would have missed. |
