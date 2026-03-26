import { html, nothing, type TemplateResult } from "lit";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry } from "../types.ts";

type SessionUsageEntry = {
  key: string;
  model?: string;
  modelProvider?: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    totalCost: number;
  } | null;
};

type SessionsUsageResult = {
  sessions: SessionUsageEntry[];
};

type UsageIndicatorState = {
  loading: boolean;
  session: SessionUsageEntry | null;
  error: string | null;
  lastFetchAt: number;
  lastSessionKey: string;
};

const REFRESH_INTERVAL_MS = 30_000;

let cachedState: UsageIndicatorState = {
  loading: false,
  session: null,
  error: null,
  lastFetchAt: 0,
  lastSessionKey: "",
};
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let activeClient: GatewayBrowserClient | null = null;
let activeSessionKey = "";
let requestUpdateFn: (() => void) | null = null;

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
}

function barColor(percent: number): string {
  if (percent >= 90) {
    return "var(--color-danger, #e74c3c)";
  }
  if (percent >= 70) {
    return "var(--color-warning, #f39c12)";
  }
  return "var(--color-accent, #3498db)";
}

function resolveContextWindow(
  session: SessionUsageEntry,
  catalog: ModelCatalogEntry[],
): number | null {
  const model = session.model?.trim().toLowerCase();
  const provider = session.modelProvider?.trim().toLowerCase();
  if (!model) {
    return null;
  }
  for (const entry of catalog) {
    if (
      entry.id.toLowerCase() === model &&
      (!provider || entry.provider.toLowerCase() === provider)
    ) {
      return entry.contextWindow ?? null;
    }
  }
  return null;
}

async function fetchSessionUsage(client: GatewayBrowserClient, sessionKey: string): Promise<void> {
  if (cachedState.loading) {
    return;
  }
  if (!sessionKey) {
    return;
  }
  cachedState = { ...cachedState, loading: true };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await client.request<SessionsUsageResult>("sessions.usage", {
      key: sessionKey,
      startDate: "2020-01-01",
      endDate: today,
      limit: 1,
    });
    const session = result?.sessions?.[0] ?? null;
    cachedState = {
      loading: false,
      session,
      error: null,
      lastFetchAt: Date.now(),
      lastSessionKey: sessionKey,
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
  requestUpdateFn = requestUpdate;
  void fetchSessionUsage(client, activeSessionKey).then(requestUpdate);
  refreshTimer = setInterval(() => {
    if (activeClient) {
      void fetchSessionUsage(activeClient, activeSessionKey).then(() => requestUpdateFn?.());
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

export function setUsageSessionKey(sessionKey: string): void {
  if (sessionKey === activeSessionKey) {
    return;
  }
  activeSessionKey = sessionKey;
  if (activeClient && requestUpdateFn) {
    void fetchSessionUsage(activeClient, sessionKey).then(() => requestUpdateFn?.());
  }
}

export function renderUsageIndicator(
  catalog: ModelCatalogEntry[],
): TemplateResult | typeof nothing {
  const { session } = cachedState;
  if (!session?.usage) {
    return nothing;
  }

  const u = session.usage;
  const ctxWindow = resolveContextWindow(session, catalog);
  const pct =
    ctxWindow && ctxWindow > 0
      ? Math.min(Math.round((u.totalTokens / ctxWindow) * 100), 100)
      : null;

  const costStr =
    u.totalCost > 0
      ? u.totalCost < 0.01
        ? `$${u.totalCost.toFixed(4)}`
        : `$${u.totalCost.toFixed(2)}`
      : "";

  const tooltipLines = [
    `Tokens: ${formatTokens(u.totalTokens)}${ctxWindow ? ` / ${formatTokens(ctxWindow)}` : ""}`,
    `Input: ${formatTokens(u.input)}`,
    `Output: ${formatTokens(u.output)}`,
    u.cacheRead > 0 ? `Cache read: ${formatTokens(u.cacheRead)}` : null,
    u.cacheWrite > 0 ? `Cache write: ${formatTokens(u.cacheWrite)}` : null,
    costStr ? `Cost: ${costStr}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return html`
    <div class="usage-indicator" title=${tooltipLines}>
      <div class="usage-indicator__bar-wrap">
        <div
          class="usage-indicator__bar"
          style="width:${pct ?? 0}%;background:${barColor(pct ?? 0)}"
        ></div>
      </div>
      <span class="usage-indicator__text">
        ${formatTokens(u.totalTokens)}${ctxWindow ? html`<small> / ${formatTokens(ctxWindow)}</small>` : nothing}
        ${costStr ? html` <span class="usage-indicator__cost">${costStr}</span>` : nothing}
      </span>
    </div>
  `;
}
