PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  playfab_title_id TEXT NOT NULL,
  photon_app_id TEXT NOT NULL,
  playfab_secret_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_links (
  game_id TEXT NOT NULL REFERENCES games(id),
  playfab_id TEXT NOT NULL,
  astral_id TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (game_id, playfab_id),
  UNIQUE (game_id, astral_id)
);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  playfab_id TEXT,
  astral_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_blocks (
  game_id TEXT NOT NULL REFERENCES games(id),
  playfab_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  blocked_at TEXT NOT NULL,
  blocked_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (game_id, playfab_id)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  playfab_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_game_created ON security_events(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_player ON security_events(game_id, playfab_id);
