// Authenticated fetch to the unified backend. Adds the Supabase access token.
import { supabase } from './supabase';
import { demoFetch, demoMode } from './demo';

// Empty = same domain (Vercel routes /api/* to the backend). Set VITE_API_URL only when the API lives elsewhere.
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '');

export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  if (demoMode) return demoFetch(path, options);
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await authHeaders()),
    ...((options.headers as Record<string, string>) || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) window.dispatchEvent(new CustomEvent('auth-expired'));
  return res;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || `Request failed (${res.status})`);
  return body as T;
}

// Download a file (CSV/JSON export) with the auth header
export async function download(path: string, filename: string) {
  const res = await apiFetch(path, { headers: {} });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
