// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — Supabase remote adapter
// ═══════════════════════════════════════════════════════════════
// Translates the sync engine's generic remote interface (ping,
// upsert, fetchAll, subscribe) into real Supabase calls. This is the
// only file that needs to know Supabase's specific API shape — the
// sync engine itself stays backend-agnostic.
// ═══════════════════════════════════════════════════════════════

// Local-only bookkeeping fields that must never be sent to the server —
// stripping them here (once, in one place) means every call site that
// writes through the sync engine can't forget to do it.
const LOCAL_ONLY_FIELDS = ["_syncStatus", "_localUpdatedAt"];

function stripLocalFields(payload) {
  const clean = { ...payload };
  LOCAL_ONLY_FIELDS.forEach(f => delete clean[f]);
  return clean;
}

export function createSupabaseRemoteAdapter(supabaseClient) {
  return {
    async ping() {
      // A cheap, real round-trip to the actual backend — not just
      // checking navigator.onLine, which only reflects the local
      // network interface, not whether Supabase is actually reachable.
      const { error } = await supabaseClient.from("schools").select("id").limit(1);
      if (error) throw error;
      return true;
    },

    async upsert(table, payload) {
      const clean = stripLocalFields(payload);
      // Conflict target is (school_id, client_id), not client_id alone —
      // see migration 003_fix_client_id_scope.sql for why: a global
      // client_id constraint would make two different schools' first-
      // ever record (both commonly "STU00001"-style ids) collide.
      const { error } = await supabaseClient.from(table).upsert(clean, { onConflict: "school_id,client_id" });
      if (error) throw error;
    },

    async fetchAll(table, sinceIso) {
      let query = supabaseClient.from(table).select("*").is("deleted_at", null);
      if (sinceIso) query = query.gte("updated_at", sinceIso);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    subscribe(table, onRow) {
      const channel = supabaseClient
        .channel(`${table}-sync-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
          if (payload.new && Object.keys(payload.new).length > 0) onRow(payload.new);
        })
        .subscribe();
      return () => supabaseClient.removeChannel(channel);
    },
  };
}
