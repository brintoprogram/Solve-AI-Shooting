import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ContactNote {
  id:             string;
  workspace_id:   string;
  contact_phone:  string;
  contact_name:   string | null;
  created_by:     string | null;
  created_by_name: string | null;
  type:           string;
  content:        string;
  follow_up_date: string | null;
  follow_up_done: boolean;
  created_at:     string;
}

export function useContactNotes(workspaceId: string, contactPhone: string) {
  const { profile } = useAuth();
  const [notes,   setNotes]   = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId || !contactPhone) { setNotes([]); setLoading(false); return; }
    const { data, error } = await db
      .from("contact_notes")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("contact_phone", contactPhone)
      .order("created_at", { ascending: false });
    if (error) console.error("[useContactNotes]", error.message);
    setNotes(data ?? []);
    setLoading(false);
  }, [workspaceId, contactPhone]);

  useEffect(() => {
    setLoading(true);
    load();

    const channel = db
      .channel(`contact-notes-${workspaceId}-${contactPhone}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contact_notes" },
        () => { load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load, workspaceId, contactPhone]);

  async function addNote(
    type: string,
    content: string,
    contactName?: string,
    followUpDate?: string | null,
  ) {
    const { data, error } = await db.from("contact_notes").insert({
      workspace_id:    workspaceId,
      contact_phone:   contactPhone,
      contact_name:    contactName ?? null,
      created_by:      profile?.id ?? null,
      created_by_name: profile?.full_name ?? null,
      type,
      content,
      follow_up_date:  followUpDate ?? null,
      follow_up_done:  false,
    }).select().single();
    if (error) { console.error("[useContactNotes] addNote:", error.message); return; }
    setNotes((prev) => [data, ...prev]);
  }

  async function toggleFollowUp(id: string, done: boolean) {
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, follow_up_done: done } : n));
    await db.from("contact_notes").update({ follow_up_done: done }).eq("id", id);
  }

  async function deleteNote(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await db.from("contact_notes").delete().eq("id", id);
  }

  const pendingFollowUps = notes.filter(
    (n) => n.type === "follow_up" && !n.follow_up_done
  ).length;

  return { notes, loading, addNote, toggleFollowUp, deleteNote, pendingFollowUps };
}
