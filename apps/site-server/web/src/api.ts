/**
 * The Site Server API from its own pages: same origin, the session cookie, and the X-EVX
 * header on every write (the server refuses writes without it).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  method: string,
  url: string,
  body?: unknown,
  type = 'application/json',
): Promise<T> {
  const raw = body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array;
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method === 'GET' ? {} : { 'x-evx': '1' }),
      ...(body === undefined ? {} : { 'content-type': raw ? type : 'application/json' }),
    },
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
  });
  if (r.status === 204) return undefined as T;
  const json = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!r.ok) throw new ApiError(r.status, json.error ?? r.statusText, json.code ?? 'error');
  return json as T;
}

export interface SiteUser {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'member';
  source: 'local' | 'ldap';
}

export interface Site {
  siteName: string;
  user: SiteUser | null;
  setup: boolean;
  directory: boolean;
  reports: boolean;
  categories: string[];
  statuses: string[];
}

export interface EnvironmentInfo {
  id: string;
  title: Record<string, string>;
  size: number;
  encrypted: boolean;
  digest: string;
  uploadedAt: string;
}

export const site = () => api<Site>('GET', '/api/site');
