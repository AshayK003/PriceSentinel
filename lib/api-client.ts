/**
 * API client for the PriceSentinel backend.
 * ponytail: bare fetch, no axios/fetch wrapper lib needed.
 * Thickens when auth + retry + pagination are needed (Phase 2).
 */

export interface BackendConfig {
  apiUrl: string;
}

export async function getConfig(): Promise<BackendConfig> {
  const result = await chrome.storage.sync.get('apiUrl');
  return { apiUrl: result.apiUrl ?? '' };
}

export async function registerPage(url: string, title?: string, selector?: string): Promise<Response> {
  const config = await getConfig();
  if (!config.apiUrl) throw new Error('Backend URL not configured (see Settings)');
  return fetch(`${config.apiUrl}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title, selector }),
  });
}

export async function unregisterPage(url: string): Promise<Response> {
  const config = await getConfig();
  if (!config.apiUrl) throw new Error('Backend URL not configured');
  return fetch(`${config.apiUrl}/pages`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export async function getChangesForPage(url: string): Promise<Response> {
  const config = await getConfig();
  if (!config.apiUrl) throw new Error('Backend URL not configured');
  return fetch(`${config.apiUrl}/changes?url=${encodeURIComponent(url)}`);
}

export async function pollNow(url: string): Promise<Response> {
  const config = await getConfig();
  if (!config.apiUrl) throw new Error('Backend URL not configured');
  return fetch(`${config.apiUrl}/pages/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export interface PageCountInfo {
  changes: number;
  last_checked: string | null;
}

export async function getChangeCounts(): Promise<Record<string, PageCountInfo>> {
  const config = await getConfig();
  if (!config.apiUrl) return {};
  try {
    const res = await fetch(`${config.apiUrl}/changes/unread-count`);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}
