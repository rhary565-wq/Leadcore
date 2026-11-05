// Apollo API service — all calls go to backend only (API key never exposed to frontend)

export type ApolloSearchFilters = {
  jobId?:          string;
  leadId?:         string;
  location?:       string;
  country?:        string;
  industry?:       string;
  customIndustry?: string;
  companySearch?:  string;   // company name or domain (comma-separated)
  seniority?:      string[];
  seniorities?:    string[];
  companySizes?:   string[];
  departments?:    string[];
  companyDomains?: string[];
  resultsLimit?:   number;
};

export type ApolloSearchResponse = {
  success:                   boolean;
  apolloRunId:               string;
  status:                    'processing' | 'completed';
  searchedCount:             number;
  enrichmentRequestedCount:  number;
  requestIds?:               string[];
  contacts?:                 ApolloContact[];   // only set if status=completed with 0 results
  message?:                  string;
  error?:                    string;
};

export type ApolloContact = {
  id:                string;
  source_type:       'apollo';
  apollo_run_id:     string;
  apollo_person_id:  string | null;
  apollo_request_id: string | null;
  person_name:       string | null;
  first_name:        string | null;
  last_name:         string | null;
  job_title:         string | null;
  company_name:      string | null;
  company_domain:    string | null;
  public_email:      string;   // always present in GET /contacts results
  public_phone:      string;   // always present in GET /contacts results
  linkedin_url:      string | null;
  confidence_score:  number;
  status:            string;
  pushed_to_hubspot: boolean;
  created_at:        string;
  updated_at:        string;
};

export type ApolloContactsResponse = {
  success:   boolean;
  count:     number;
  contacts:  ApolloContact[];
  message?:  string;
  error?:    string;
};

export type ApolloRun = {
  id:                         string;
  job_id:                     string | null;
  lead_id:                    string | null;
  status:                     'created' | 'processing' | 'completed' | 'error' | 'cancelled';
  search_count:               number;
  enrichment_requested_count: number;
  valid_contacts_count:       number;
  search_payload:             Record<string, string[]> | null;
  request_ids:                string[];
  error_message:              string | null;
  created_at:                 string;
  updated_at:                 string;
};

export type ApolloRunResponse = {
  success:            boolean;
  run:                ApolloRun;
  validContactsFound: number;
  error?:             string;
};

export type ApolloRunsResponse = {
  success: boolean;
  count:   number;
  runs:    ApolloRun[];
  error?:  string;
};

import { API_URL as BACKEND, apiFetch as authedFetch } from '@/lib/http';
const BASE = `${BACKEND}/api/apollo`;

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res  = await authedFetch(url, options);
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as any).error || `Request failed: ${res.status}`);
  return data;
}

// ── Trigger Apollo search → Bulk Enrichment (async)
// Returns apolloRunId immediately; results arrive via webhook.
export async function startApolloSearch(filters: ApolloSearchFilters): Promise<ApolloSearchResponse> {
  return apiFetch<ApolloSearchResponse>(`${BASE}/search`, {
    method: 'POST',
    body:   JSON.stringify(filters),
  });
}

// ── Get Apollo contacts (source_type=apollo, email+phone required)
export async function getApolloContacts(params?: {
  apolloRunId?: string;
  jobId?:       string;
  status?:      string;
  search?:      string;
}): Promise<ApolloContactsResponse> {
  const q = new URLSearchParams();
  if (params?.apolloRunId) q.set('apolloRunId', params.apolloRunId);
  if (params?.jobId)       q.set('jobId',       params.jobId);
  if (params?.status)      q.set('status',      params.status);
  if (params?.search)      q.set('search',      params.search);
  return apiFetch<ApolloContactsResponse>(`${BASE}/contacts?${q.toString()}`);
}

// ── List all runs (Apollo Dashboard)
export async function getApolloRuns(): Promise<ApolloRunsResponse> {
  return apiFetch<ApolloRunsResponse>(`${BASE}/runs`);
}

// ── Poll single run status
export async function getApolloRun(runId: string): Promise<ApolloRunResponse> {
  return apiFetch<ApolloRunResponse>(`${BASE}/runs/${runId}`);
}

// ── Manual poll if webhook was missed
export async function pollApolloResult(requestId: string, apolloRunId: string): Promise<{ success: boolean; savedSalesReadyContacts: number }> {
  return apiFetch(`${BASE}/poll-result/${encodeURIComponent(requestId)}?apolloRunId=${encodeURIComponent(apolloRunId)}`);
}

// ── Re-enrich one lead via Apollo
export async function enrichLeadWithApollo(leadId: string, filters?: Partial<ApolloSearchFilters>): Promise<ApolloSearchResponse> {
  return apiFetch<ApolloSearchResponse>(`${BASE}/enrich/${leadId}`, {
    method: 'POST',
    body:   JSON.stringify(filters || {}),
  });
}

// ── Cancel a stuck processing run (marks status = 'cancelled' in DB)
export async function cancelApolloRun(runId: string): Promise<{ success: boolean; message: string }> {
  return apiFetch(`${BASE}/runs/${runId}/cancel`, { method: 'POST' });
}

// ── Cancel ALL stuck processing/created runs
export async function cancelAllStuckRuns(): Promise<{ success: boolean; cancelledCount: number; message: string }> {
  return apiFetch(`${BASE}/runs/cancel-all-stuck`, { method: 'POST' });
}

// ── Delete a run (soft-delete — contacts preserved in DB)
export async function deleteApolloRun(runId: string): Promise<{ success: boolean; message: string }> {
  return apiFetch(`${BASE}/runs/${runId}`, { method: 'DELETE' });
}

// ── Retry a failed or cancelled run (re-runs People Search + Bulk Enrichment)
export async function retryApolloRun(runId: string): Promise<{ success: boolean; status: string; searchedCount?: number; message?: string }> {
  return apiFetch(`${BASE}/runs/${runId}/retry`, { method: 'POST' });
}

// ── Approve / Reject / Push (reuse key-contacts routes — these work for any source)
export async function approveContact(id: string): Promise<void> {
  await apiFetch(`${BACKEND}/api/key-contacts/${id}/approve`, { method: 'POST' });
}

export async function rejectContact(id: string): Promise<void> {
  await apiFetch(`${BACKEND}/api/key-contacts/${id}/reject`, { method: 'POST' });
}

export async function pushContactToHubSpot(id: string): Promise<void> {
  await apiFetch(`${BACKEND}/api/key-contacts/${id}/push-hubspot`, { method: 'POST' });
}

export async function bulkApproveContacts(ids: string[]): Promise<void> {
  await apiFetch(`${BACKEND}/api/key-contacts/bulk-approve`, { method: 'POST', body: JSON.stringify({ contactIds: ids }) });
}

export async function bulkPushToHubSpot(ids: string[]): Promise<void> {
  await apiFetch(`${BACKEND}/api/key-contacts/bulk-push-hubspot`, { method: 'POST', body: JSON.stringify({ contactIds: ids, jobId: 'manual' }) });
}
