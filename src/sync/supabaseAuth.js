// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — Supabase auth adapter
// ═══════════════════════════════════════════════════════════════
// Implements the `auth` interface that cloudSyncSetup.js expects,
// backed by the real Supabase client. Kept separate from
// cloudSyncSetup.js itself so that module could be tested with a
// fake auth implementation (see client/test/cloudSyncSetup.test.js)
// without needing network access.
// ═══════════════════════════════════════════════════════════════

export function createSupabaseAuth(supabaseClient) {
  return {
    async signUpAndSignIn(email, password) {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        // Email confirmation is required to be OFF for this to work —
        // see the Phase A setup guide, Step 3. If we get here without
        // a session, sign-in explicitly as a fallback.
        const { error: signInError } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (signInError) {
          throw new Error(
            "Could not create an active session after sign-up. This usually means " +
            "'Confirm email' is still ON in Supabase → Authentication → Providers → Email."
          );
        }
      }
      return true;
    },

    async signIn(email, password) {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return true;
    },

    async registerSchool(name) {
      const { data, error } = await supabaseClient.rpc("register_school", { p_name: name });
      if (error) throw error;
      return data;
    },

    async getLinkedSchoolId() {
      const { data, error } = await supabaseClient
        .from("school_members")
        .select("school_id")
        .maybeSingle();
      if (error) throw error;
      return data?.school_id || null;
    },

    async signOut() {
      await supabaseClient.auth.signOut();
    },
  };
}
