import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import type { WatchedPage } from '~/lib/storage';

interface ChangeEntry {
  id: number;
  summary: string;
  created_at: string;
  diff: { type: string; text: string }[];
}

interface PageStatus {
  changes: number;
  lastChecked: string | null;
}

/* ── Utilities ───────────────────────────────────────── */

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function plural(n: number, w: string): string {
  return n === 1 ? w : `${w}s`;
}

/* ── Spinner component ────────────────────────────────── */

function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span class="spinner" role="img" aria-label={label} />
  );
}

/* ── Main popup component ────────────────────────────── */

export function Popup() {
  const [pages, setPages] = useState<WatchedPage[]>([]);
  const [pageStatuses, setPageStatuses] = useState<Record<string, PageStatus>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [backendUrl, setBackendUrl] = useState('');

  const [currentTabUrl, setCurrentTabUrl] = useState('');
  const [currentTabTitle, setCurrentTabTitle] = useState('');
  const [selector, setSelector] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [currentWatched, setCurrentWatched] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [pageChanges, setPageChanges] = useState<Record<string, ChangeEntry[]>>({});
  const [loadingChanges, setLoadingChanges] = useState<Set<string>>(new Set());
  const [pollingPages, setPollingPages] = useState<Set<string>>(new Set());

  const refreshCounter = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Data fetching (debounced) ──────────────────────── */

  const refreshData = useCallback(() => {
    // Debounce: if called again within 300ms, reset the timer
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const tag = ++refreshCounter.current;
      setLoadError(null);

      chrome.runtime.sendMessage({ type: 'GET_PAGES' }, (res) => {
        if (tag !== refreshCounter.current) return;
        if (chrome.runtime.lastError) {
          setLoadError(chrome.runtime.lastError.message ?? 'Failed to load pages');
          setLoading(false);
          return;
        }
        setPages(res?.pages ?? []);
        setLoading(false);
      });

      chrome.runtime.sendMessage({ type: 'GET_CHANGE_COUNTS' }, (res) => {
        if (tag !== refreshCounter.current) return;
        if (res?.statuses) setPageStatuses(res.statuses);
      });
    }, 300);
  }, []);

  useEffect(() => {
    /* Get current tab info */
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.url) {
        setCurrentTabUrl(tab.url);
        setCurrentTabTitle(tab.title || tab.url);
      }
    });

    /* Check backend connectivity with an actual /health ping */
    chrome.runtime.sendMessage({ type: 'GET_BACKEND_STATUS' }, (res) => {
      if (res?.connected) {
        setBackendStatus('connected');
        setBackendUrl(res.apiUrl);
      } else {
        setBackendStatus('disconnected');
      }
    });

    refreshData();
  }, [refreshData]);

  /* Sync local watched state with current tab URL */
  useEffect(() => {
    const existing = pages.find((p) => p.url === currentTabUrl);
    setCurrentWatched(!!existing);
    if (existing?.selector) setSelector(existing.selector);
    else setSelector('');
  }, [pages, currentTabUrl]);

  /* ── Handlers (optimistic) ──────────────────────────── */

  const handleWatchPage = () => {
    // Optimistic: add page immediately, sync background
    const newPage: WatchedPage = { url: currentTabUrl, title: currentTabTitle, selector: selector || undefined, addedAt: Date.now() };
    setPages((prev) => {
      if (prev.some((p) => p.url === currentTabUrl)) return prev; // already present
      return [newPage, ...prev];
    });
    setCurrentWatched(true);
    setAddError(null);
    setShowAdvanced(false);

    // Actual background sync
    chrome.runtime.sendMessage(
      { type: 'ADD_PAGE', url: currentTabUrl, title: currentTabTitle, selector: selector || undefined },
      (res) => {
        if (res && !res.ok) {
          // Rollback on failure
          setPages((prev) => prev.filter((p) => p.url !== currentTabUrl));
          setCurrentWatched(false);
          setAddError(res.error ?? 'Failed to add page');
        }
      },
    );
  };

  const handleUnwatchPage = () => {
    // Optimistic: remove immediately
    setPages((prev) => prev.filter((p) => p.url !== currentTabUrl));
    setCurrentWatched(false);
    setSelector('');
    setAddError(null);
    setShowAdvanced(false);

    chrome.runtime.sendMessage({ type: 'REMOVE_PAGE', url: currentTabUrl });
  };

  const handlePickFromPage = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'ENTER_PICKER' });
        window.close();
      }
    });
  };

  const handleRemove = (url: string) => {
    // Optimistic: remove immediately
    setPages((prev) => prev.filter((p) => p.url !== url));
    if (expandedPage === url) {
      setExpandedPage(null);
      setPageChanges((prev) => { const n = { ...prev }; delete n[url]; return n; });
    }
    chrome.runtime.sendMessage({ type: 'REMOVE_PAGE', url });
  };

  const handleCheckNow = (url: string) => {
    setPollingPages((prev) => new Set(prev).add(url));
    chrome.runtime.sendMessage({ type: 'POLL_NOW', url }, (res) => {
      setPollingPages((prev) => { const n = new Set(prev); n.delete(url); return n; });
      if (res && !res.ok) {
        setAddError(res.error || 'Check failed');
      } else {
        refreshData();
      }
    });
  };

  const toggleExpand = (url: string) => {
    if (expandedPage === url) {
      setExpandedPage(null);
      return;
    }

    setExpandedPage(url);

    if (!pageChanges[url]) {
      setLoadingChanges((prev) => new Set(prev).add(url));
      chrome.runtime.sendMessage({ type: 'GET_CHANGES', url }, (res) => {
        setLoadingChanges((prev) => { const n = new Set(prev); n.delete(url); return n; });
        if (res?.changes) {
          setPageChanges((prev) => ({ ...prev, [url]: res.changes }));
        }
      });
    }
  };

  /* ── States: loading, error, empty ──────────────────── */

  if (loading) {
    return (
      <div class="popup">
        <header>
          <div class="header-left">
            <h1>PriceSentinel</h1>
          </div>
        </header>
        <div class="skeleton" role="status" aria-label="Loading watched pages">
          <div class="skeleton-row" />
          <div class="skeleton-row" />
          <div class="skeleton-row" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div class="popup">
        <header>
          <div class="header-left">
            <h1>PriceSentinel</h1>
          </div>
          <div class="header-actions">
            <button class="btn btn-ghost btn-icon" onClick={refreshData} aria-label="Retry loading">
              ↻
            </button>
          </div>
        </header>
        <div class="state-message" role="alert">
          <div class="state-icon">⚠️</div>
          <div class="state-title">Failed to load</div>
          <p>{loadError}</p>
          <div class="state-action">
            <button class="btn btn-primary btn-sm" onClick={refreshData}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────── */

  const changedCount = pages.filter((p) => (pageStatuses[p.url]?.changes ?? 0) > 0).length;

  return (
    <div class="popup">
      {/* ── Header ─────────────────────────────────────── */}
      <header>
        <div class="header-left">
          <h1>PriceSentinel</h1>
          {changedCount > 0 && (
            <span class="header-badge">
              {changedCount} {plural(changedCount, 'change')}
            </span>
          )}
        </div>
        <div class="header-actions">
          <button class="btn btn-ghost btn-icon" onClick={refreshData} aria-label="Refresh page list">
            ↻
          </button>
        </div>
      </header>

      {/* ── Backend status ─────────────────────────────── */}
      <div class="backend-status" role="status" aria-live="polite">
        <span class={`backend-dot ${backendStatus}`} />
        {backendStatus === 'checking' && 'Checking backend…'}
        {backendStatus === 'connected' && `Backend connected`}
        {backendStatus === 'disconnected' && 'Backend not configured — open Settings'}
      </div>

      {/* ── Current page section ───────────────────────── */}
      {currentTabUrl && (
        <section class="current-page" aria-label="Current page">
          <div class="current-page-header">
            <span class="current-page-title">{currentTabTitle}</span>
            <span class="current-page-url">{currentTabUrl}</span>
          </div>

          {currentWatched ? (
            <>
              {selector && <span class="selector-badge">CSS: {selector}</span>}
              <div class="current-page-actions">
                <button class="btn btn-danger btn-sm" onClick={handleUnwatchPage} aria-label={`Unwatch ${currentTabTitle}`}>
                  ✕ Unwatch
                </button>
              </div>
            </>
          ) : (
            <>
              {addError && (
                <div class="state-message" role="alert" style="padding: 8px; font-size: 12px;">
                  <p style="color: var(--color-danger);">{addError}</p>
                </div>
              )}
              <div class="current-page-actions">
                <button
                  class="btn btn-primary btn-sm"
                  onClick={handleWatchPage}
                >
                  + Watch this page
                </button>
                <button
                  class="btn btn-soft btn-sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  aria-expanded={showAdvanced}
                  aria-controls="selector-section"
                >
                  {showAdvanced ? '− Less' : '+ CSS selector'}
                </button>
              </div>
              {showAdvanced && (
                <div id="selector-section" class="advanced-section">
                  <label for="selector-input">CSS selector <span class="help-text">(optional)</span></label>
                  <div class="selector-row">
                    <input
                      id="selector-input"
                      class="input"
                      type="text"
                      placeholder=".pricing-card .price"
                      value={selector}
                      onInput={(e) => setSelector((e.target as HTMLInputElement).value)}
                      aria-describedby="selector-help"
                    />
                    <button class="btn btn-soft btn-sm" onClick={handlePickFromPage} aria-label="Pick element from page">
                      Pick
                    </button>
                  </div>
                  <p id="selector-help" class="help-text">
                    Target a specific element. Leave empty to watch the whole page.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Watched pages list ──────────────────────────── */}
      {pages.length === 0 ? (
        <div class="state-message">
          <div class="state-icon">👀</div>
          <div class="state-title">No pages watched yet</div>
          <p>Visit a pricing page and click <strong>+ Watch this page</strong> above to start tracking changes.</p>
          <p style="font-size: 12px; color: var(--color-text-muted);">
            You can track up to 5 pages on the free plan.
          </p>
        </div>
      ) : (
        <ul class="page-list" role="list" aria-label="Watched pages">
          {pages.map((page) => {
            const status = pageStatuses[page.url];
            const changeCount = status?.changes ?? 0;
            const isPolling = pollingPages.has(page.url);
            const isExpanded = expandedPage === page.url;
            const hasChanges = changeCount > 0;
            const changes = pageChanges[page.url];
            const isLoadingChanges = loadingChanges.has(page.url);

            return (
              <li
                key={page.url}
                class={`page-list-item${isExpanded ? ' expanded' : ''}${hasChanges ? ' has-changes' : ''}`}
              >
                <div
                  class={`page-row${hasChanges ? ' clickable' : ''}`}
                  onClick={() => hasChanges && toggleExpand(page.url)}
                  role={hasChanges ? 'button' : undefined}
                  tabIndex={hasChanges ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (hasChanges && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      toggleExpand(page.url);
                    }
                  }}
                  aria-expanded={hasChanges ? isExpanded : undefined}
                  aria-label={hasChanges ? `${page.title || page.url} — ${changeCount} ${plural(changeCount, 'change')}` : page.title || page.url}
                >
                  <div class="page-info">
                    <span class="page-title">{page.title || page.url}</span>
                    <span class="page-url">{page.url}</span>
                    <div class="page-meta">
                      {status?.lastChecked && (
                        <span class="last-checked">checked {timeAgo(status.lastChecked)}</span>
                      )}
                    </div>
                  </div>
                  <div class="page-actions">
                    {hasChanges && <span class="change-badge">{changeCount}</span>}
                    <button
                      class="btn btn-soft btn-sm"
                      onClick={(e) => { e.stopPropagation(); handleCheckNow(page.url); }}
                      disabled={isPolling}
                      aria-label={`Check ${page.title || page.url} for changes`}
                    >
                      {isPolling ? <Spinner /> : 'Check'}
                    </button>
                    <button
                      class="remove-btn"
                      onClick={(e) => { e.stopPropagation(); handleRemove(page.url); }}
                      aria-label={`Remove ${page.title || page.url} from watch list`}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div class="change-list" role="region" aria-label={`Changes for ${page.title || page.url}`}>
                    {isLoadingChanges && (
                      <div class="changes-loading">
                        <Spinner /> Loading changes…
                      </div>
                    )}
                    {!isLoadingChanges && (!changes || changes.length === 0) && (
                      <p class="state-message" style="padding: 12px; font-size: 12px;">
                        No changes recorded yet.
                      </p>
                    )}
                    {!isLoadingChanges && changes?.map((c) => (
                      <div key={c.id} class="change-entry">
                        <div class="change-entry-header">
                          <span class="change-summary">{c.summary}</span>
                          <span class="change-time">{timeAgo(c.created_at)}</span>
                        </div>
                        {c.diff.map((seg, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: stable order, small list
                          <div key={i} class={`diff-segment diff-${seg.type}`}>
                            {seg.text}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Footer ──────────────────────────────────────── */}
      <footer>
        <a href="#" class="footer-link" onClick={(e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); }}>
          Settings
        </a>
        <a
          href="https://github.com/AshayK003/PriceSentinel"
          target="_blank"
          rel="noopener noreferrer"
          class="footer-link"
          onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: 'https://github.com/AshayK003/PriceSentinel' }); }}
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}
