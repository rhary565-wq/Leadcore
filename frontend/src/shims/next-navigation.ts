// Drop-in replacement for `next/navigation` (useRouter, useParams, usePathname, useSearchParams).
import { useMemo } from 'react';
import { useLocation, useNavigate, useParams as useRRParams, useSearchParams as useRRSearch } from 'react-router-dom';

// In the unified app the old LeadGen "Launch" page ("/") lives at /discover
export function mapPath(href: string): string {
  if (href === '/' || href.startsWith('/?')) return '/discover' + href.slice(1);
  return href;
}

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(() => ({
    push: (href: string) => navigate(mapPath(href)),
    replace: (href: string) => navigate(mapPath(href), { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
    prefetch: () => {},
  }), [navigate]);
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRRParams() as unknown as T;
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const [params] = useRRSearch();
  return params;
}
