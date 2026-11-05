// Authentication for the unified YodSales + LeadGen API.
//
// The frontend logs users in with Supabase Auth (YodSales login) and sends
// `Authorization: Bearer <access_token>` on every API call. We verify that
// token with Supabase and attach `req.user = { id, email, name, isAdmin }`.
//
// AUTH_SUPABASE_URL / AUTH_SUPABASE_ANON_KEY → the project users log in to
// (defaults to SUPABASE_URL / SUPABASE_ANON_KEY when both apps share one project).
// ADMIN_EMAILS → comma-separated list of admin emails.
// AUTH_REQUIRED=false → disables the check (local demo only).

const { createClient } = require('@supabase/supabase-js');
const { supabase } = require('../db/supabase');
const { internalToken } = require('../services/cloudtasks');

let _authClient = null;
function authClient() {
  if (!_authClient) {
    const url = process.env.AUTH_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.AUTH_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('Supabase auth is not configured (AUTH_SUPABASE_URL / AUTH_SUPABASE_ANON_KEY)');
    _authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _authClient;
}

const cache = new Map(); // token → { user, exp }
const CACHE_MS = 60_000;

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

async function lookupRole(userId, email) {
  if (adminEmails().includes((email || '').toLowerCase())) return 'admin';
  try {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
    return data?.role || 'Sales Rep';
  } catch {
    return 'Sales Rep';
  }
}

async function resolveUser(token) {
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;

  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data?.user) return null;

  const u = data.user;
  const role = await lookupRole(u.id, u.email);
  const user = {
    id: u.id,
    email: u.email,
    name: u.user_metadata?.full_name || u.user_metadata?.name || u.email,
    avatar: u.user_metadata?.avatar_url || null,
    role,
    isAdmin: role === 'admin',
  };
  cache.set(token, { user, exp: Date.now() + CACHE_MS });
  if (cache.size > 5000) cache.clear();
  return user;
}

async function requireAuth(req, res, next) {
  if (process.env.AUTH_REQUIRED === 'false') {
    req.user = { id: '00000000-0000-0000-0000-000000000000', email: 'demo@local', name: 'Demo User', role: 'admin', isAdmin: true };
    return next();
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please sign in' });
  try {
    const user = await resolveUser(token);
    if (!user) return res.status(401).json({ error: 'Session expired — please sign in again' });
    // Disabled accounts can only read their own profile (so the UI can explain why)
    if (user.role === 'disabled' && !(req.method === 'GET' && req.path === '/me')) {
      return res.status(403).json({ error: 'Your account is disabled' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('[auth]', err.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access only' });
  next();
}

// /worker/* endpoints: only Cloud Tasks (or the local queue) may call them.
function requireInternal(req, res, next) {
  if (req.headers['x-internal-token'] !== internalToken()) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireInternal };
