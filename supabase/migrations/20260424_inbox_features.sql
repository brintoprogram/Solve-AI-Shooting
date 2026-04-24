-- Inbox Features: internal notes + quick replies
-- Run this in the Supabase SQL Editor

-- 1. Internal notes flag on inbox_messages
ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

-- 2. Quick replies table
CREATE TABLE IF NOT EXISTS quick_replies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        text NOT NULL,
  body         text NOT NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quick_replies_workspace_isolation" ON quick_replies
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
