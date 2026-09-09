/**
 * Cloud sync + authentication for the AI Farms tracker.
 *
 * The Supabase project URL and anon key are baked in at BUILD time from
 * environment variables, so you never type them on a device. They are safe
 * to ship in the bundle — every browser-based Supabase app does this. What
 * actually protects the data is Supabase Auth plus row-level security: each
 * row is tied to a user id, and the database only returns rows belonging to
 * the signed-in user.
 *
 * The whole farm state is stored as ONE JSON document per user, which keeps
 * sync simple and reliable for a single operator moving between phone and PC.
 *
 * Trade-off: this is last-write-wins at the document level. If you log on
 * your phone AND your PC without syncing in between, the device that pushes
 * last overwrites the other. Sync when you arrive and when you finish.
 */

const SESSION_KEY = 'aifarms_session_v1';
const CONFIG_KEY = 'aifarms_cloud_config_v1';

/**
 * Connection details come from build-time env vars when they're set (so you
 * never type them), and otherwise from whatever was entered in the app. The
 * in-app path matters: if a build ships without env vars, you can still
 * connect from the phone without waiting on a redeploy.
 */
export function getCloudConfig() {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (envUrl && envKey) return { url: envUrl, key: envKey, source: 'env' };

  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (saved && saved.url && saved.key) {
      return { url: saved.url.replace(/\/$/, ''), key: saved.key, source: 'device' };
    }
  } catch (e) { /* corrupt config */ }
  return { url: '', key: '', source: 'none' };
}

export function saveCloudConfig({ url, key }) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: (url || '').trim(), key: (key || '').trim() }));
}

export function clearCloudConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

export function isCloudConfigured() {
  const c = getCloudConfig();
  return Boolean(c.url && c.key);
}

/** Verify a URL/key pair actually points at a Supabase project. */
export async function testCloudConfig(url, key) {
  const clean = (url || '').trim().replace(/\/$/, '');
  if (!/^https:\/\/.+/.test(clean)) throw new Error('URL must start with https://');
  if (!key || key.trim().length < 20) throw new Error('That anon key looks too short.');
  let res;
  try {
    res = await fetch(`${clean}/auth/v1/settings`, { headers: { apikey: key.trim() } });
  } catch (e) {
    throw new Error('Could not reach that URL — check it and your connection.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('Project reachable, but that anon key was rejected.');
  if (!res.ok) throw new Error(`Project responded with ${res.status}. Check the URL.`);
  return true;
}

/* ------------------------------------------------------------------ */
/* Session storage                                                     */
/* ------------------------------------------------------------------ */

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.access_token) return s;
  } catch (e) { /* corrupt session */ }
  return null;
}

function setSession(s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

export function getUser() {
  const s = getSession();
  return s ? s.user : null;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

async function authRequest(path, body) {
  const { url, key } = getCloudConfig();
  if (!url || !key) throw new Error('Cloud is not set up on this device yet.');
  const res = await fetch(`${url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyAuthError(data, res.status));
  return data;
}

export async function signIn(email, password) {
  const data = await authRequest('token?grant_type=password', { email, password });
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: data.user?.id, email: data.user?.email },
  };
  setSession(session);
  return session;
}

export async function signUp(email, password) {
  const data = await authRequest('signup', { email, password });
  // If email confirmation is switched off, Supabase returns a session here.
  if (data.access_token) {
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: { id: data.user?.id, email: data.user?.email },
    };
    setSession(session);
    return session;
  }
  return null; // needs email confirmation
}

export async function resetPassword(email) {
  await authRequest('recover', { email });
}

export function signOut() {
  setSession(null);
}

/** Swap an expiring refresh token for a fresh access token. */
let refreshInFlight = null;

async function refreshSession(session) {
  const data = await authRequest('token?grant_type=refresh_token', {
    refresh_token: session.refresh_token,
  });
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: data.user?.id ?? session.user.id, email: data.user?.email ?? session.user.email },
  };
  setSession(next);
  return next;
}

/** Return a valid session, refreshing it if it's close to expiry.
    Auto-sync can trigger from more than one place in quick succession
    (a debounced save, the tab regaining focus), so concurrent calls here
    share a single in-flight refresh — otherwise two requests can race to
    use the same one-time refresh token and the loser gets signed out. */
async function validSession() {
  let session = getSession();
  if (!session) throw new Error('Not signed in.');
  if (session.expires_at && session.expires_at - Date.now() < 60_000) {
    try {
      if (!refreshInFlight) {
        refreshInFlight = refreshSession(session).finally(() => { refreshInFlight = null; });
      }
      session = await refreshInFlight;
    } catch (e) {
      setSession(null);
      throw new Error('Session expired — please sign in again.');
    }
  }
  return session;
}

function friendlyAuthError(data, status) {
  const msg = (data.msg || data.error_description || data.message || '').toLowerCase();
  if (msg.includes('invalid login')) return 'Wrong email or password.';
  if (msg.includes('already registered')) return 'That email already has an account — sign in instead.';
  if (msg.includes('password should be')) return 'Password must be at least 6 characters.';
  if (msg.includes('email not confirmed')) return 'Check your email and confirm the account first.';
  if (msg.includes('unable to validate email')) return 'That email address looks invalid.';
  if (status === 429) return 'Too many attempts — wait a moment and try again.';
  return data.msg || data.error_description || data.message || `Sign-in failed (${status}).`;
}

/* ------------------------------------------------------------------ */
/* Farm state read / write                                             */
/* ------------------------------------------------------------------ */

function restHeaders(session) {
  return {
    'Content-Type': 'application/json',
    apikey: getCloudConfig().key,
    Authorization: `Bearer ${session.access_token}`,
  };
}

/** Fetch the cloud copy. Returns { state, updatedAt } or null if none saved yet. */
export async function pullRemote() {
  const session = await validSession();
  const res = await fetch(
    `${getCloudConfig().url}/rest/v1/farm_state?user_id=eq.${session.user.id}&select=state,updated_at`,
    { headers: restHeaders(session) }
  );
  if (!res.ok) throw new Error(await describeError(res));

  const rows = await res.json();
  if (!rows.length) return null;
  return { state: rows[0].state, updatedAt: rows[0].updated_at };
}

/** Write local state up to the cloud, replacing whatever is there. */
export async function pushRemote(data) {
  const session = await validSession();
  const updatedAt = new Date().toISOString();
  const body = [{
    user_id: session.user.id,
    state: { ...data, updatedAt },
    updated_at: updatedAt,
  }];

  const res = await fetch(`${getCloudConfig().url}/rest/v1/farm_state?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...restHeaders(session), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await describeError(res));
  return updatedAt;
}

/** Turn a failed response into something actionable. */
async function describeError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.message || body.hint || '';
  } catch (e) { /* no JSON body */ }

  if (res.status === 401 || res.status === 403) {
    return 'Cloud rejected the request — sign out and sign in again.';
  }
  if (res.status === 404) {
    return 'Table "farm_state" not found — run supabase-setup.sql in your project first.';
  }
  return `Sync failed (${res.status}). ${detail}`.trim();
}
