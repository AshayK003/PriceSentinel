<div align="center">
  <img src="public/icons/icon-128.png" alt="PriceSentinel" width="80" height="80" />
  <h1 align="center">PriceSentinel</h1>
  <p align="center">
    Pin competitor pricing pages. Get notified when they change.
    <br />
    <a href="#quick-start"><strong>Quick Start »</strong></a>
    ·
    <a href="#architecture"><strong>Architecture »</strong></a>
    ·
    <a href="#api"><strong>API »</strong></a>
  </p>

  <p align="center">
    <a href="#"><img src="https://img.shields.io/badge/version-0.1.0-blue.svg" alt="Version" /></a>
    <a href="#"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" /></a>
    <a href="#"><img src="https://img.shields.io/badge/build-passing-brightgreen.svg" alt="Build" /></a>
    <a href="#"><img src="https://img.shields.io/badge/PRs-welcome-orange.svg" alt="PRs Welcome" /></a>
  </p>
</div>

---

PriceSentinel is a Chrome extension — with a lightweight Python backend — that lets you pin competitor pricing pages and get notified when prices, tiers, or features change. The extension overlays visual diffs when you revisit a page, and the backend handles scheduled polling with email, Slack, and Telegram alerts.

**10 seconds to install. 30 seconds to pin your first page. Zero infrastructure costs.**

---

## Features

| | Feature | Description |
|---|---|---|
| 🎯 | **CSS Selector Targeting** | Pinpoint specific prices or elements — ignore nav, footers, and noise |
| 👁️ | **Visual Diff Overlay** | Revisit a watched page and see changes highlighted inline (green = added, red = removed) |
| 📋 | **Change History** | Expand any watched page in the popup to browse past diffs |
| 🔔 | **Multi-Channel Alerts** | Email (SMTP), Slack webhook, or Telegram Bot API |
| 🔄 | **Scheduled Polling** | Backend checks pages daily — no need to keep Chrome open |
| 📊 | **Badge Count** | Extension icon shows pending changes at a glance |
| 🔍 | **On-Demand Check** | "Check Now" button triggers an immediate poll |
| 🆓 | **Free Tier** | 5 watched pages, no account required |
| 📡 | **Local-First** | Extension works offline with `chrome.storage` — backend is optional |
| 🚀 | **Tiny Footprint** | 44 kB extension build, 6 Python deps, $0 third-party services |

---

## Demo

### Pin a page
Open the extension popup, click "Watch this page", optionally pick a CSS selector for the exact price element.

### See changes
When you revisit a watched page, PriceSentinel fetches the latest diff and highlights it:

```
┌─────────────────────────────────────┐
│  👁 Watched                         │
│                                     │
│  ╔═ Pro Plan ═══════════════════╗   │
│  ║  $29  →  $49  (price change) ║   │  ← Red outline + tooltip
│  ╚═══════════════════════════════╝   │
└─────────────────────────────────────┘
```

### Check history
Open the popup → tap any watched page → see a list of past changes with timestamps and inline diff highlights.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- Python ≥ 3.11
- Chrome (for loading the unpacked extension)

### 1. Install & Build the Extension

```bash
npm install
npx wxt build
```

Load the extension in Chrome:
1. Open `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select `.output/chrome-mv3/`

### 2. Start the Backend (optional — needed for polling & alerts)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Connect & Use

1. Right-click the extension icon → **Settings**
2. Enter `http://localhost:8000` as the API URL
3. Visit a pricing page → click the extension icon → **Watch this page**

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION                      │
│                                                         │
│  ┌─────────────────┐    ┌──────────────────────────┐    │
│  │  CONTENT SCRIPT  │    │    SERVICE WORKER         │   │
│  │                  │    │                           │   │
│  │ - Diff overlay   │◄──►│ - chrome.storage mgmt    │   │
│  │ - Element picker │    │ - Message routing         │   │
│  │ - Badge injection│    │ - API calls to backend    │   │
│  └─────────────────┘    └──────────┬────────────────┘   │
│                                     │                    │
│  ┌─────────────────┐               │                    │
│  │    POPUP UI      │              │                    │
│  │  - Watchlist     │              │                    │
│  │  - Change history│              │                    │
│  │  - Check Now     │              │                    │
│  │  - Settings      │              │                    │
│  └─────────────────┘              │                    │
└────────────────────────────────────┼────────────────────┘
                                     │  HTTP (REST API)
                                     ▼
┌─────────────────────────────────────────────────────────┐
│                   BACKEND (FastAPI)                      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Poll Worker   │  │ Diff Engine  │  │ Notification  │  │
│  │ (APScheduler) │─►│ (difflib)   │─►│ Dispatcher    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │          │
│         ▼                 ▼                 │          │
│  ┌──────────────────────────────┐           │          │
│  │       SQLite Database        │           │          │
│  └──────────────────────────────┘           │          │
│                                              │          │
│  ┌──────────────────────────────┐           │          │
│  │  Slacks Webhook / SMTP / TG  │◄──────────┘          │
│  └──────────────────────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. User pins a page → extension saves URL (+ optional CSS selector) to `chrome.storage`
2. Service worker syncs the page to the backend API
3. Backend schedules polling via APScheduler (default: daily)
4. Poll worker fetches page HTML with httpx
5. Diff engine compares against the last stored snapshot using `difflib.SequenceMatcher`
6. If a meaningful change is detected → store new snapshot + diff → dispatch notifications
7. On next visit → content script fetches the latest diff and renders inline highlights

### Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Extension Framework | [WXT](https://wxt.dev/) (TypeScript) | Best MV3 dev experience, auto manifest gen, HMR |
| UI | [Preact](https://preactjs.com/) + Plain CSS | 8 KB, fast renders, no framework overhead |
| Backend | [FastAPI](https://fastapi.tiangolo.com/) + [SQLAlchemy](https://www.sqlalchemy.org/) | Async, type-safe, auto docs |
| Database | SQLite | Zero infrastructure, stdlib |
| Poll Scheduler | [APScheduler](https://apscheduler.readthedocs.io/) | In-process, no Redis needed |
| Page Fetch | [httpx](https://www.python-httpx.org/) | 11 MB vs 300 MB for Playwright |
| Diff Engine | Python `difflib` (stdlib) | Zero dependencies |
| Notifications | `smtplib` (stdlib) + webhooks | No SendGrid/Slack SDKs needed |

---

## Project Structure

```
PriceSentinel/
├── entrypoints/
│   ├── background.ts          # Service worker — message routing, alarms, context menus
│   ├── content.ts             # Content script — diff overlay, element picker, badge
│   ├── popup/
│   │   ├── Popup.tsx          # Main popup — watched pages, change history, Check Now
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── style.css
│   └── options/
│       ├── Options.tsx         # Settings — API URL, notification config
│       ├── index.html
│       ├── main.tsx
│       └── style.css
├── lib/
│   ├── storage.ts             # chrome.storage wrappers with 5-page free tier
│   ├── messaging.ts           # Content ↔ service worker message helpers
│   └── api-client.ts          # Backend API client (bare fetch, no SDK)
├── backend/
│   ├── main.py                # FastAPI entrypoint with lifespan + scheduler
│   ├── models.py              # SQLAlchemy: WatchedPage, PageSnapshot, DiffResult, AlertConfig
│   ├── schemas.py             # Pydantic request/response models
│   ├── routers/
│   │   ├── pages.py           # CRUD + on-demand poll trigger
│   │   ├── changes.py         # Change retrieval + bulk unread counts
│   │   └── alerts.py          # Notification config CRUD
│   ├── services/
│   │   ├── poll.py            # Full poll cycle: fetch → diff → store → notify
│   │   ├── fetcher.py         # httpx-based page fetcher
│   │   ├── differ.py          # HTML diff engine (difflib + BeautifulSoup)
│   │   ├── notifier.py        # Email (smtplib) + Slack/Telegram webhook dispatch
│   │   └── scheduler.py       # APScheduler wrapper
│   └── tests/
│       └── test_differ.py     # Diff engine tests
├── public/icons/              # Extension icons (16, 48, 128)
├── wxt.config.ts              # WXT build configuration
├── package.json               # npm: wxt, preact
├── tsconfig.json
└── .gitignore
```

---

## API

### Pages

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/pages` | List all watched pages |
| `POST` | `/pages` | Add a watched page |
| `DELETE` | `/pages?url=...` | Remove a watched page |
| `POST` | `/pages/poll` | Trigger an immediate poll |

### Changes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/changes?url=...&limit=N` | Get changes for a page |
| `GET` | `/changes/unread-count` | Get change counts per page |

### Alerts

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/alerts` | Configure notification channels |
| `DELETE` | `/alerts` | Remove alert config |
| `GET` | `/alerts` | List alert configs |

### Example: Pin a page

```bash
curl -X POST http://localhost:8000/pages \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/pricing", "title": "Example Pricing", "selector": ".pricing-card .price"}'
```

---

## Development

### Extension (HMR)

```bash
npx wxt dev
```

Opens a dev server with hot module replacement. Changes reflect instantly.

### Backend

```bash
cd backend
uvicorn main:app --reload --port 8000
```

Auto-reloads on file changes. API docs at `http://localhost:8000/docs`.

### Tests

```bash
cd backend
python tests/test_differ.py
```

---

## Deployment

The backend is designed for a $5–10/mo VPS (Railway, Fly.io, or a plain Linux box):

```bash
# Install deps
pip install -r requirements.txt

# Run with a process manager (or Docker)
uvicorn main:app --host 0.0.0.0 --port 8000
```

> **Tip:** Behind a reverse proxy (nginx, Caddy) with basic auth for the API server.

---

## Pricing (Future)

| Tier | Price | Pages | Polling | Alerts |
|---|---|---|---|---|
| **Free** | $0 | 5 | Daily | Email |
| **Pro** | $9/mo | Unlimited | Hourly | Email + Slack + Telegram |
| **Enterprise** | $99/mo | Unlimited | Custom | All + SSO + API |

---

## Roadmap

**Phase 2** — Community & Polish
- [ ] Slack/Telegram alert verification
- [ ] Playwright screenshot capture
- [ ] Open-source diff-engine as standalone package
- [ ] Stripe Pro tier ($9/mo)

**Phase 3** — AI-Powered Intelligence
- [ ] AI change summaries (Claude/OpenAI)
- [ ] SaaS tier mapping (Starter/Pro/Enterprise)
- [ ] Weekly digest email
- [ ] Team collaboration

---

## Contributing

PRs are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your feature branch (`git checkout -b feat/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feat/amazing`)
5. Open a Pull Request

---

## License

MIT © [Ashay Kushwaha](https://github.com/AshayK003)
