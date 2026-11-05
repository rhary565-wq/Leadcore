// Always use the backend URL — baked in at build time via NEXT_PUBLIC_API_URL
import { apiFetch } from './http';

export interface Job {
  id: string;
  created_at: string;
  status: 'queued' | 'pending' | 'running' | 'apollo_enriching' | 'enriching' | 'contact_fallback' | 'cleaning' | 'done' | 'error';
  config: JobConfig;
  apify_run_id?: string;
  total_records: number;
  hot_count: number;
  warm_count: number;
  low_count: number;
  last_error?: string;   // set by scrape/clean workers when status='error'
}
export interface JobConfig {
  queries: string[];
  location: string;
  country: string;
  province?: string;        // Thailand province OR 'All Thailand' (new)
  language?: string;
  industryFilter?: string;
  maxResults?: number;
  minRating?: number;
  createdBy?: string;
  apolloEnabled?: boolean;
  autoApprove?: boolean;    // skip human review — auto-approve all leads + contacts and push to HubSpot
  maxContacts?: number;     // cap total contacts saved per job (Apollo API budget)
  district?: string;        // YodSales Thai hierarchy
  subDistrict?: string;
  engine?: 'apify' | 'gosom' | 'demo';  // Google Maps engine
  extractEmail?: boolean;
}
export interface Lead {
  id: string;
  job_id: string;
  company_name: string;
  industry: string;
  address: string;
  city: string;
  phone: string;
  website: string;
  rating: number;
  reviews_count: number;
  lead_score: number;
  lead_status: 'Hot' | 'Warm' | 'Low';
  approval_status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string;
  reviewer_notes?: string;
  hubspot_contact_id?: string;
  hubspot_company_id?: string;
  pushed_to_hubspot: boolean;
  google_maps_url?: string;
  enrichment_status?: 'not_started' | 'queued' | 'enriching' | 'enriched' | 'no_contacts_found' | 'failed';
  enriched_at?: string;
  // Apollo company enrichment (new)
  apollo_company_id?:          string;
  apollo_headcount?:           number;
  apollo_revenue?:             number;
  apollo_revenue_range?:       string;
  apollo_company_enriched_at?: string;
  dbd_url?:                    string;
  // Unified app
  latitude?:  number | null;
  longitude?: number | null;
  email?:     string | null;
  province?:  string | null;
  district?:  string | null;
  sub_district?: string | null;
  created_at?: string;
}

export interface ApolloEnrichResult {
  success:      boolean;
  found:        boolean;
  apolloOrgId:  string | null;
  headcount:    number | null;
  revenue:      number | null;
  revenueRange: string | null;
  dbdUrl:       string;
  contactCount: number;
  message:      string;
}

export interface KeyContact {
  id: string;
  lead_id: string;
  company_name: string;
  person_name: string;
  first_name: string;
  last_name: string;
  job_title: string;
  department: string;
  seniority: string;
  linkedin_url: string;
  source_url: string;
  source_type: string;
  public_email: string;
  public_phone: string;
  confidence_score: number;
  confidence_reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'pushed';
  reviewer_notes: string;
  hubspot_contact_id?: string;
  pushed_to_hubspot: boolean;
  created_at: string;
  updated_at: string;
  // Company intelligence (Apollo)
  company_headcount?:    number;
  company_revenue?:      string;
  company_description?:  string;
  company_tech_stack?:   string;
  company_founded_year?: number;
  company_city?:         string;
  company_linkedin?:     string;
  // Person intelligence (Apollo)
  person_city?:          string;
  person_headline?:      string;
  contact_location?:     string;
  apollo_company_id?:    string;
  apollo_person_id?:     string;
  // Batch/job context (for grouping in All Contacts)
  job_id?:         string | null;
  job_config?:     { queries?: string[]; location?: string; country?: string } | null;
  job_created_at?: string | null;
}

export interface ContactStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  pushed: number;
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const createJob    = (config: JobConfig) => req<{ jobId: string; message: string }>('/api/jobs', { method: 'POST', body: JSON.stringify({ config, createdBy: config.createdBy }) });
export const getJobs      = ()                  => req<Job[]>('/api/jobs');
export const deleteJob    = (id: string)        => req<{ success: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' });
export const getJob       = (id: string)        => req<Job>(`/api/jobs/${id}`);
export const getJobStats        = (id: string) => req<Record<string, number>>(`/api/jobs/${id}/stats`);
export const getJobContactStats = (id: string) => req<{
  totalLeads: number; apollo: number; fallback: number; total: number;
  apolloLeads: number; fallbackLeads: number;
}>(`/api/jobs/${id}/contact-stats`);
export const getLeads     = (params: { jobId?: string; status?: string; limit?: number }) => {
  const q = new URLSearchParams();
  if (params.jobId)  q.set('jobId', params.jobId);
  if (params.status) q.set('status', params.status);
  if (params.limit)  q.set('limit', String(params.limit));
  return req<Lead[]>(`/api/leads?${q.toString()}`);
};
export const getLead      = (id: string)        => req<Lead>(`/api/leads/${id}`);
export const approveLeads = (ids: string[], approvedBy: string, jobId: string) =>
  req('/api/leads/approve', { method: 'POST', body: JSON.stringify({ leadIds: ids, approvedBy, jobId }) });
export const rejectLeads  = (ids: string[], reason: string, rejectedBy: string) =>
  req('/api/leads/reject',  { method: 'POST', body: JSON.stringify({ leadIds: ids, reason, rejectedBy }) });
export const saveNotes    = (id: string, notes: string) =>
  req(`/api/leads/${id}/notes`, { method: 'PATCH', body: JSON.stringify({ notes }) });

// ── Key Contacts ──────────────────────────────────────────────────────────────
export const getKeyContacts = (params: { leadId?: string; jobId?: string; status?: string }) => {
  const q = new URLSearchParams();
  if (params.leadId) q.set('leadId', params.leadId);
  if (params.jobId)  q.set('jobId',  params.jobId);
  if (params.status) q.set('status', params.status);
  return req<KeyContact[]>(`/api/key-contacts?${q.toString()}`);
};

export const getContactStats = (jobId: string) =>
  req<ContactStats>(`/api/key-contacts/stats/${jobId}`);

export const approveContact = (id: string, reviewerNotes?: string) =>
  req(`/api/key-contacts/${id}/approve`, { method: 'POST', body: JSON.stringify({ reviewerNotes }) });

export const rejectContact = (id: string, reviewerNotes?: string) =>
  req(`/api/key-contacts/${id}/reject`,  { method: 'POST', body: JSON.stringify({ reviewerNotes }) });

export const pushContactToHubspot = (id: string) =>
  req(`/api/key-contacts/${id}/push-hubspot`, { method: 'POST', body: JSON.stringify({}) });

export const bulkApproveContacts = (contactIds: string[]) =>
  req('/api/key-contacts/bulk-approve', { method: 'POST', body: JSON.stringify({ contactIds }) });

export const bulkPushContactsToHubspot = (contactIds: string[], jobId: string) =>
  req('/api/key-contacts/bulk-push-hubspot', { method: 'POST', body: JSON.stringify({ contactIds, jobId }) });

export const triggerEnrichment = (leadId: string, jobId: string) =>
  req(`/api/key-contacts/enrich/${leadId}`, { method: 'POST', body: JSON.stringify({ jobId }) });

// ── Apollo.io Enrichment ──────────────────────────────────────────────────────
export interface ApprovedLead {
  id: string;
  company_name: string;
  website: string;
  lead_status: 'Hot' | 'Warm' | 'Low';
  lead_score: number;
  job_id: string;
  phone: string;
  city: string;
  address: string;
  rating: number;
  reviews_count: number;
  google_maps_url: string;
  apollo_stats: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    pushed: number;
  } | null;
}

export const getApolloLeads = (jobId?: string) => {
  const q = jobId ? `?jobId=${jobId}` : '';
  return req<ApprovedLead[]>(`/api/apollo/leads${q}`);
};

export const runApolloEnrich = (leadId: string) =>
  req<{ count: number; message: string }>(`/api/apollo/enrich/${leadId}`, { method: 'POST', body: JSON.stringify({}) });

export const getApolloContactsByLead = (leadId: string) =>
  req<KeyContact[]>(`/api/apollo/contacts/${leadId}`);

// All Apollo contacts (standalone search results) — for the Apollo approval page
export const getApolloContacts = (params?: { status?: string; search?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.search) q.set('search', params.search);
  const qs = q.toString();
  return req<KeyContact[]>(`/api/apollo/contacts${qs ? '?' + qs : ''}`);
};

// ── Company Details / Apollo Company Enrichment ───────────────────────────────

// Trigger Apollo company enrichment for one Apify lead (+ fetch contacts)
export const enrichLeadWithApollo = (leadId: string) =>
  req<ApolloEnrichResult>(`/api/leads/${leadId}/enrich-apollo`, { method: 'POST', body: JSON.stringify({}) });

// Get Apollo company contacts already saved for a lead
export const getLeadApolloContacts = (leadId: string) =>
  req<{ success: boolean; count: number; contacts: KeyContact[] }>(`/api/leads/${leadId}/apollo-contacts`);

// Sync selected Apollo contacts to HubSpot (reuses existing bulk push)
export const pushApolloContactsToHubspot = (contactIds: string[], jobId?: string) =>
  req('/api/key-contacts/bulk-push-hubspot', {
    method: 'POST',
    body: JSON.stringify({ contactIds, jobId: jobId || 'manual' }),
  });
