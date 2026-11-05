import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

// No-login mode (local testing only): VITE_AUTH_DISABLED=true + backend AUTH_REQUIRED=false
export const authDisabled = import.meta.env.VITE_AUTH_DISABLED === 'true';

// Auth only — all data goes through the backend API.
export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
