import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { DEFAULT_VISIBLE_FIELDS } from "@/lib/contactFields";

export function useContactFields(workspaceId: string) {
  const [visibleFields, setVisibleFields] = useState<string[]>(DEFAULT_VISIBLE_FIELDS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    supabase
      .from("workspaces")
      .select("shooting_visible_fields")
      .eq("id", workspaceId)
      .single()
      .then(({ data }) => {
        const fields = data?.shooting_visible_fields as string[] | null;
        if (fields && fields.length > 0) setVisibleFields(fields);
        setLoading(false);
      });
  }, [workspaceId]);

  async function saveVisibleFields(fields: string[]) {
    setVisibleFields(fields);
    await supabase
      .from("workspaces")
      .update({ shooting_visible_fields: fields })
      .eq("id", workspaceId);
  }

  return { visibleFields, loading, saveVisibleFields };
}
