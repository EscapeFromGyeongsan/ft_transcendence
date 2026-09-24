CREATE TABLE IF NOT EXISTS game_matches (
  id UUID PRIMARY KEY,
  game_type TEXT NOT NULL,
  room_id UUID NOT NULL,
  room_title TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  move_count INTEGER CHECK (move_count >= 0)
);
CREATE TABLE IF NOT EXISTS game_match_players (
  match_id UUID NOT NULL REFERENCES game_matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  seat INTEGER NOT NULL CHECK (seat >= 0),
  name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss', 'draw')),
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, seat)
);
CREATE INDEX IF NOT EXISTS game_match_players_user_idx ON game_match_players(user_id, match_id);
INSERT INTO game_matches (id, game_type, room_id, room_title, started_at, finished_at, reason, move_count)
SELECT id, 'omok', room_id, room_title, started_at, finished_at, reason, move_count FROM matches
ON CONFLICT (id) DO NOTHING;
INSERT INTO game_match_players (match_id, user_id, seat, name, outcome)
SELECT id, black_user_id, 0, black_name,
  CASE WHEN winner IS NULL THEN 'draw' WHEN winner = 'black' THEN 'win' ELSE 'loss' END FROM matches
UNION ALL
SELECT id, white_user_id, 1, white_name,
  CASE WHEN winner IS NULL THEN 'draw' WHEN winner = 'white' THEN 'win' ELSE 'loss' END FROM matches
ON CONFLICT (match_id, user_id) DO NOTHING;
