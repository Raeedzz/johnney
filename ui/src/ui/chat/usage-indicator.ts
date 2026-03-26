import { html, nothing, type TemplateResult } from "lit";
import type { GatewayBrowserClient } from "../gateway.ts";

type UsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

type ProviderUsageSnapshot = {
  provider: string;
  displayName: string;
  windows: UsageWindow[];
  plan?: string;
  error?: string;
};

type UsageSummary = {
  updatedAt: number;
  providers: ProviderUsageSnapshot[];
};

type UsageIndicatorState = {
  loading: boolean;
  summary: UsageSummary | null;
  error: string | null;
  lastFetchAt: number;
};

const REFRESH_INTERVAL_MS = 60_000;
const TRACKED_PROVIDERS = new Set(["anthropic", "google-gemini-cli"]);

let cachedState: UsageIndicatorState = {
  loading: false,
  summary: null,
  error: null,
  lastFetchAt: 0,
};
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let activeClient: GatewayBrowserClient | null = null;

function barColor(percent: number): string {
  if (percent >= 90) {
    return "var(--color-danger, #e74c3c)";
  }
  if (percent >= 70) {
    return "var(--color-warning, #f39c12)";
  }
  return "var(--color-success, #27ae60)";
}

function formatResetTime(resetAt: number | undefined): string {
  if (!resetAt) {
    return "";
  }
  const diffMs = resetAt - Date.now();
  if (diffMs <= 0) {
    return "resetting...";
  }
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h${rem}m` : `${hrs}h`;
}

function renderProviderUsage(snapshot: ProviderUsageSnapshot): TemplateResult {
  if (snapshot.error) {
    return html`
      <div class="usage-indicator__provider">
        <span class="usage-indicator__label">${snapshot.displayName}</span>
        <span class="usage-indicator__error" title=${snapshot.error}>err</span>
      </div>
    `;
  }

  const windows = snapshot.windows.filter((w) => w.usedPercent > 0 || w.resetAt);
  if (windows.length === 0) {
    return html`
      <div class="usage-indicator__provider">
        <span class="usage-indicator__label">${snapshot.displayName}</span>
        <div class="usage-indicator__bar-wrap" title="No usage data">
          <div class="usage-indicator__bar" style="width:0%;background:var(--color-success,#27ae60)"></div>
        </div>
        <span class="usage-indicator__pct">0%</span>
      </div>
    `;
  }

  // Show the highest usage window
  const primary = windows.reduce((a, b) => (a.usedPercent >= b.usedPercent ? a : b));
  const pct = Math.round(primary.usedPercent);
  const resetStr = formatResetTime(primary.resetAt);
  const title = windows
    .map(
      (w) =>
        `${w.label}: ${Math.round(w.usedPercent)}%${w.resetAt ? ` (resets ${formatResetTime(w.resetAt)})` : ""}`,
    )
    .join("\n");

  return html`
    <div class="usage-indicator__provider" title=${title}>
      <span class="usage-indicator__label">${snapshot.displayName}</span>
      <div class="usage-indicator__bar-wrap">
        <div
          class="usage-indicator__bar"
          style="width:${Math.min(pct, 100)}%;background:${barColor(pct)}"
        ></div>
      </div>
      <span class="usage-indicator__pct">${pct}%${resetStr ? html` <small>${resetStr}</small>` : nothing}</span>
    </div>
  `;
}

async function fetchUsageStatus(client: GatewayBrowserClient): Promise<void> {
  if (cachedState.loading) {
    return;
  }
  cachedState = { ...cachedState, loading: true };
  try {
    const summary = await client.request<UsageSummary>("usage.status", {});
    cachedState = {
      loading: false,
      summary,
      error: null,
      lastFetchAt: Date.now(),
    };
  } catch (err) {
    cachedState = {
      ...cachedState,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function startUsagePolling(client: GatewayBrowserClient, requestUpdate: () => void): void {
  if (refreshTimer && activeClient === client) {
    return;
  }
  stopUsagePolling();
  activeClient = client;
  void fetchUsageStatus(client).then(requestUpdate);
  refreshTimer = setInterval(() => {
    void fetchUsageStatus(client).then(requestUpdate);
  }, REFRESH_INTERVAL_MS);
}

export function stopUsagePolling(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  activeClient = null;
}

export function renderUsageIndicator(): TemplateResult | typeof nothing {
  const { summary } = cachedState;
  if (!summary || summary.providers.length === 0) {
    return nothing;
  }

  const tracked = summary.providers.filter((p) => TRACKED_PROVIDERS.has(p.provider));
  if (tracked.length === 0) {
    return nothing;
  }

  return html`
    <div class="usage-indicator">
      ${tracked.map(renderProviderUsage)}
    </div>
  `;
}
