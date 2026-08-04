-- In-app support chat (tenant ↔ Lyncr admin).
-- Run in Neon SQL Editor after 127-admin-support-emails.sql.
-- One active conversation per business owner (users.id); reopen closed threads on new messages.

CREATE TABLE IF NOT EXISTS support_chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Business owner who owns this conversation
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- open = new/empty, waiting = tenant messaged / awaiting agent, closed = resolved
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'waiting', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  -- Unread counters for each side (reset when that side opens the thread)
  admin_unread_count INT NOT NULL DEFAULT 0,
  user_unread_count INT NOT NULL DEFAULT 0,
  -- Set true after we insert the system “agent will be with you shortly” line
  waiting_agent_notice_sent BOOLEAN NOT NULL DEFAULT FALSE
);

-- At most one non-closed thread per owner (MVP). Closed rows may pile up historically.
CREATE UNIQUE INDEX IF NOT EXISTS support_chat_threads_one_active_per_user
  ON support_chat_threads (user_id)
  WHERE status IN ('open', 'waiting');

CREATE INDEX IF NOT EXISTS support_chat_threads_last_message_idx
  ON support_chat_threads (last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS support_chat_threads_admin_unread_idx
  ON support_chat_threads (admin_unread_count DESC, last_message_at DESC NULLS LAST)
  WHERE admin_unread_count > 0;

CREATE TABLE IF NOT EXISTS support_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES support_chat_threads(id) ON DELETE CASCADE,
  -- user = tenant, admin = platform admin, system = automated notice
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin', 'system')),
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_chat_messages_thread_created_idx
  ON support_chat_messages (thread_id, created_at ASC);

CREATE TABLE IF NOT EXISTS support_chat_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES support_chat_messages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_chat_attachments_message_idx
  ON support_chat_attachments (message_id);

COMMENT ON TABLE support_chat_threads IS
  'In-app Lyncr Support chat threads (one active open/waiting thread per owner).';
COMMENT ON TABLE support_chat_messages IS
  'Messages in support_chat_threads (user, admin, or system).';
COMMENT ON TABLE support_chat_attachments IS
  'File/image attachments for support chat messages (Vercel Blob URLs).';
