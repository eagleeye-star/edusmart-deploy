// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — Supabase client instance
// ═══════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

// Read from environment variables rather than hardcoding — this file
// is safe to commit to a public repo as-is. Set the actual values in
// a local .env.local file (gitignored) for development, and in your
// hosting provider's environment variable settings (e.g. Vercel
// Project Settings → Environment Variables) for deployment. See
// .env.example for the exact variable names expected.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "Supabase environment variables are missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). " +
    "Cloud Sync will not work until these are set — see .env.example. " +
    "Everything else in EduSmart works normally without them."
  );
}

// autoRefreshToken stays ON here (unlike the short-lived verify.js
// script) — this is a long-running app session that needs its login
// to keep renewing itself in the background for as long as EduSmart
// is open.
export const supabase = createClient(SUPABASE_URL || "https://placeholder.supabase.co", SUPABASE_ANON_KEY || "placeholder", {
  auth: { autoRefreshToken: true, persistSession: true },
});
