import { html, nothing, type TemplateResult } from "lit";
import type { GatewayBrowserClient } from "../gateway.ts";

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

function formatCost(cost: number): string {
  if (cost <= 0) {
    return "";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
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
  // Fetch immediately on session change
  if (activeClient && requestUpdateFn) {
    void fetchSessionUsage(activeClient, sessionKey).then(() => requestUpdateFn?.());
  }
}

export function renderUsageIndicator(): TemplateResult | typeof nothing {
  const { session } = cachedState;
  if (!session?.usage) {
    return nothing;
  }

  const u = session.usage;
  const provider = session.modelProvider ?? "";
  const model = session.model ?? "";
  const label = model || provider || "session";
  const costStr = formatCost(u.totalCost);

  const title = [
    `Input: ${formatTokens(u.input)}`,
    `Output: ${formatTokens(u.output)}`,
    u.cacheRead > 0 ? `Cache read: ${formatTokens(u.cacheRead)}` : null,
    u.cacheWrite > 0 ? `Cache write: ${formatTokens(u.cacheWrite)}` : null,
    costStr ? `Cost: ${costStr}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return html`
    <div class="usage-indicator" title=${title}>
      <span class="usage-indicator__label">${label}</span>
      <span class="usage-indicator__stat">
        <small>in</small> ${formatTokens(u.input)}
      </span>
      <span class="usage-indicator__stat">
        <small>out</small> ${formatTokens(u.output)}
      </span>
      ${
        costStr
          ? html`<span class="usage-indicator__stat usage-indicator__cost">${costStr}</span>`
          : nothing
      }
    </div>
  `;
}
