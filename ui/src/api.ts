import type {
  PaymentRecord,
  PolicyFile,
  ProfileId,
  ScenarioId,
  ServerConfig,
} from './types';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8787';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // Keep the status text when the body is not JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export const api = {
  getConfig: () => request<ServerConfig>('/api/config'),
  getPayments: () =>
    request<{ payments: PaymentRecord[] }>('/api/payments'),
  getTrace: (id: string) =>
    request<PaymentRecord>(`/api/trace/${encodeURIComponent(id)}`),
  savePolicy: (policy: PolicyFile) =>
    request<{ policy: PolicyFile }>('/api/policy', {
      method: 'POST',
      body: JSON.stringify(policy),
    }),
  setProfile: (profile: ProfileId) =>
    request<ServerConfig>('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ profile }),
    }),
  runDemo: (scenario: ScenarioId) =>
    request<PaymentRecord>(`/api/demo/${encodeURIComponent(scenario)}`, {
      method: 'POST',
    }),
};
