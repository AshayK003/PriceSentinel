import { useState, useEffect } from 'preact/hooks';

const DEFAULT_SETTINGS = {
  apiUrl: '',
  email: '',
  slackWebhook: '',
  telegramToken: '',
  telegramChatId: '',
};

type Settings = typeof DEFAULT_SETTINGS;

function validateUrl(url: string): boolean {
  if (!url) return true; // empty is valid (optional)
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      setSettings(items as Settings);
    });
  }, []);

  const update = (key: keyof Settings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (key === 'apiUrl') {
      if (value && !validateUrl(value)) {
        setUrlError('Enter a valid http:// or https:// URL');
      } else {
        setUrlError('');
      }
    }
  };

  const save = () => {
    if (settings.apiUrl && !validateUrl(settings.apiUrl)) return;
    chrome.storage.sync.set(settings, () => {
      setSaved(true);
      setTestResult(null);
      setTimeout(() => setSaved(false), 2500);
    });
  };

  const testConnection = async () => {
    if (!settings.apiUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${settings.apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        setTestResult({ ok: true, msg: `Connected — ${res.status} ${res.statusText}` });
      } else {
        setTestResult({ ok: false, msg: `Server responded with ${res.status} ${res.statusText}` });
      }
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Could not reach server' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div class="options">
      <header class="options-header">
        <h1>PriceSentinel</h1>
        <p class="options-subtitle">Settings</p>
      </header>

      {/* ── Backend ─────────────────────────────── */}
      <section class="options-section">
        <h2 class="section-heading">Backend</h2>
        <div class="field">
          <label for="api-url" class="field-label required">API URL</label>
          <input
            id="api-url"
            class={`field-input${urlError ? ' field-input-error' : ''}`}
            type="url"
            placeholder="https://api.pricesentinel.dev"
            value={settings.apiUrl}
            onInput={(e) => update('apiUrl', (e.target as HTMLInputElement).value)}
            aria-invalid={!!urlError}
            aria-describedby={urlError ? 'api-url-error' : undefined}
          />
          {urlError && <p id="api-url-error" class="field-error" role="alert">{urlError}</p>}
          <p class="field-hint">
            Your PriceSentinel backend server URL. Required for polling and change detection.
          </p>
          <div class="field-actions">
            <button
              class="btn btn-soft btn-sm"
              onClick={testConnection}
              disabled={testing || !settings.apiUrl || !!urlError}
              aria-label="Test backend connection"
            >
              {testing ? <span class="spinner" /> : 'Test connection'}
            </button>
            {testResult && (
              <span class={`test-status ${testResult.ok ? 'test-ok' : 'test-fail'}`} role="status">
                {testResult.ok ? '✓' : '✗'} {testResult.msg}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── Notifications ───────────────────────── */}
      <section class="options-section">
        <h2 class="section-heading">Notifications</h2>

        <div class="field">
          <label for="email" class="field-label">Email address</label>
          <input
            id="email"
            class="field-input"
            type="email"
            placeholder="you@example.com"
            value={settings.email}
            onInput={(e) => update('email', (e.target as HTMLInputElement).value)}
            aria-describedby="email-hint"
          />
          <p id="email-hint" class="field-hint">Notifications sent via the backend's SMTP config.</p>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Telegram</legend>
          <div class="field">
            <label for="telegram-token" class="field-label">Bot Token</label>
            <input
              id="telegram-token"
              class="field-input"
              type="text"
              placeholder="123456:ABC-DEF..."
              value={settings.telegramToken}
              onInput={(e) => update('telegramToken', (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label for="telegram-chat" class="field-label">Chat ID</label>
            <input
              id="telegram-chat"
              class="field-input"
              type="text"
              placeholder="-1001234567890"
              value={settings.telegramChatId}
              onInput={(e) => update('telegramChatId', (e.target as HTMLInputElement).value)}
            />
          </div>
        </fieldset>

        <div class="field">
          <label for="slack-url" class="field-label">Slack Webhook URL</label>
          <input
            id="slack-url"
            class="field-input"
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            value={settings.slackWebhook}
            onInput={(e) => update('slackWebhook', (e.target as HTMLInputElement).value)}
          />
        </div>
      </section>

      {/* ── Save ────────────────────────────────── */}
      <div class="save-row">
        <button
          class="btn btn-primary"
          onClick={save}
          disabled={!!urlError}
        >
          {saved ? '✓ Saved' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
