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
};

const REFRESH_INTERVAL_MS = 60_000;

let cachedState: UsageIndicatorState = {
  loading: false,
  summary: null,
  error: null,
};
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let activeClient: GatewayBrowserClient | null = null;
let requestUpdateFn: (() => void) | null = null;

function barColor(percent: number): string {
  if (percent >= 90) {
    return "var(--color-danger, #e74c3c)";
  }
  if (percent >= 70) {
    return "var(--color-warning, #f39c12)";
  }
  return "var(--color-accent, #3498db)";
}

function formatResetTime(resetAt: number | undefined): string {
  if (!resetAt) {
    return "";
  }
  const diffMs = resetAt - Date.now();
  if (diffMs <= 0) {
    return "resetting";
  }
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h${rem}m` : `${hrs}h`;
}

function renderWindow(w: UsageWindow): TemplateResult {
  const pct = Math.round(w.usedPercent);
  const resetStr = formatResetTime(w.resetAt);
  const title = `${w.label}: ${pct}% used${resetStr ? ` (resets in ${resetStr})` : ""}`;

  return html`
    <div class="usage-indicator__window" title=${title}>
      <span class="usage-indicator__window-label">${w.label}</span>
      <div class="usage-indicator__bar-wrap">
        <div
          class="usage-indicator__bar"
          style="width:${Math.min(pct, 100)}%;background:${barColor(pct)}"
        ></div>
      </div>
      <span class="usage-indicator__pct">${pct}%</span>
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
    cachedState = { loading: false, summary, error: null };
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
  requestUpdateFn = requestUpdate;
  void fetchUsageStatus(client).then(requestUpdate);
  refreshTimer = setInterval(() => {
    if (activeClient) {
      void fetchUsageStatus(activeClient).then(() => requestUpdateFn?.());
    }
  }, REFRESH_INTERVAL_MS);
}

export function stopUsagePolling(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  activeClient = null;
  requestUpdateFn = null;
}

function renderProviderSection(
  label: string,
  provider: ProviderUsageSnapshot | undefined,
): TemplateResult | typeof nothing {
  if (!provider) {
    return nothing;
  }
  const windows = provider.error ? [] : provider.windows;
  return html`
    <div class="usage-indicator">
      <span class="usage-indicator__label">${label}</span>
      ${
        windows.length > 0
          ? windows.map(renderWindow)
          : html`<span class="usage-indicator__pct">${provider.error ? "N/A" : "—"}</span>`
      }
    </div>
  `;
}

export function renderUsageIndicator(): TemplateResult | typeof nothing {
  const { summary } = cachedState;
  if (!summary || summary.providers.length === 0) {
    return nothing;
  }

  const anthropic = summary.providers.find((p) => p.provider === "anthropic");
  const gemini = summary.providers.find((p) => p.provider === "google-gemini-cli");

  if (!anthropic && !gemini) {
    return nothing;
  }

  return html`
    ${renderProviderSection("Claude", anthropic)}
    ${renderProviderSection("Google", gemini)}
  `;
}
