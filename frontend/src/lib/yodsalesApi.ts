// YodSales features on the unified backend (profile, activity, AI, pipeline, admin…)
import { api, download } from './http';
import type { Lead } from './api';

export interface Profile {
  id: string; email: string; full_name: string; role: string; isAdmin?: boolean;
  language: 'EN' | 'TH'; theme: string; phone?: string; territory?: string;
  targets?: { daily: number; weekly: number; monthly: number };
  created_at?: string; updated_at?: string;
}
export interface ActivityLog {
  id: string; user_id: string; user_email?: string; event_type: string; ip_address: string;
  device_info: string; location_text: string; created_at: string;
}
export interface Location { id: string; nameEn: string; nameTh: string; zip?: number }
export interface PipelineItem {
  id: string; lead_id?: string | null; company_name: string; phone?: string; website?: string;
  industry?: string; city?: string; province?: string; lead_score?: number; lead_status?: string;
  stage: Stage; deal_value?: number; next_follow_up?: string | null; notes?: string;
  created_at: string; updated_at: string;
}
export type Stage = 'new' | 'contacted' | 'meeting' | 'proposal' | 'won' | 'lost';
export interface SearchTemplate { id: string; name: string; config: any; created_at: string }
export interface SupportTicket { id: string; name: string; email: string; subject: string; message: string; status: string; created_at: string }
export interface Summary {
  totals: { leads: number; hot: number; warm: number; low: number; pending: number; approved: number; pushed: number; contacts: number; contactsPushed: number };
  byIndustry: { name: string; value: number }[];
  byCity: { name: string; value: number }[];
  byProvince: { name: string; value: number }[];
  trend: { day: string; leads: number }[];
  recentJobs: any[];
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const ys = {
  me: () => api<Profile>('/api/me'),
  updateMe: (patch: Partial<Profile>) => api<Profile>('/api/me', { method: 'PATCH', ...json(patch) }),

  logActivity: (eventType: string, locationText = '') =>
    api('/api/activity', { method: 'POST', ...json({ eventType, locationText }) }).catch(() => null),
  myActivity: () => api<ActivityLog[]>('/api/activity'),

  provinces: () => api<Location[]>('/api/locations/provinces'),
  districts: (provinceId: string) => api<Location[]>(`/api/locations/provinces/${provinceId}/districts`),
  subDistricts: (districtId: string) => api<Location[]>(`/api/locations/districts/${districtId}/sub-districts`),

  summary: () => api<Summary>('/api/insights/summary'),
  leads: (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return api<Lead[]>(`/api/insights/leads?${q}`);
  },
  exportLeads: (params: Record<string, string | undefined>, format: 'csv' | 'json' = 'csv') => {
    const q = new URLSearchParams(Object.entries({ ...params, format }).filter(([, v]) => v) as [string, string][]);
    return download(`/api/insights/export?${q}`, `yodsales-leads-${new Date().toISOString().slice(0, 10)}.${format}`);
  },

  pipeline: () => api<PipelineItem[]>('/api/pipeline'),
  addToPipeline: (leadIds: string[]) => api<{ added: number }>('/api/pipeline', { method: 'POST', ...json({ leadIds }) }),
  updatePipeline: (id: string, patch: Partial<PipelineItem>) => api<PipelineItem>(`/api/pipeline/${id}`, { method: 'PATCH', ...json(patch) }),
  removePipeline: (id: string) => api(`/api/pipeline/${id}`, { method: 'DELETE' }),

  templates: () => api<SearchTemplate[]>('/api/templates'),
  saveTemplate: (name: string, config: any) => api<SearchTemplate>('/api/templates', { method: 'POST', ...json({ name, config }) }),
  deleteTemplate: (id: string) => api(`/api/templates/${id}`, { method: 'DELETE' }),

  support: (t: { name: string; email: string; subject: string; message: string }) =>
    api<SupportTicket>('/api/support', { method: 'POST', ...json(t) }),

  aiChat: (messages: { role: 'user' | 'assistant'; content: string }[], lang: 'EN' | 'TH', leadId?: string) =>
    api<{ reply: string }>('/api/ai/chat', { method: 'POST', ...json({ messages, lang, leadId }) }),

  admin: {
    summary: () => api<{ users: number; jobs: number; leads: number; events24h: number; openTickets: number }>('/api/admin/summary'),
    users: () => api<Profile[]>('/api/admin/users'),
    setRole: (id: string, role: string) => api<Profile>(`/api/admin/users/${id}/role`, { method: 'PATCH', ...json({ role }) }),
    activity: () => api<ActivityLog[]>('/api/admin/activity'),
    tickets: () => api<SupportTicket[]>('/api/admin/support'),
    setTicket: (id: string, status: string) => api<SupportTicket>(`/api/admin/support/${id}`, { method: 'PATCH', ...json({ status }) }),
  },
};
