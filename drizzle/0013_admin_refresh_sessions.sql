CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  refresh_hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX admin_sessions_user ON admin_sessions(user_id);
--> statement-breakpoint
CREATE TABLE admin_refresh_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES admin_sessions(id) ON DELETE CASCADE,
  used_at INTEGER
);
--> statement-breakpoint
CREATE INDEX admin_refresh_family ON admin_refresh_tokens(session_id);
