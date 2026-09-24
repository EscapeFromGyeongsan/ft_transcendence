CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL,
  room_title TEXT NOT NULL,
  black_user_id UUID NOT NULL REFERENCES users(id),
  white_user_id UUID NOT NULL REFERENCES users(id),
  black_name TEXT NOT NULL,
  white_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  winner TEXT CHECK (winner IN ('black', 'white')),
  reason TEXT NOT NULL CHECK (reason IN ('five', 'resignation', 'draw')),
  move_count INTEGER NOT NULL CHECK (move_count >= 0),
  CHECK (black_user_id <> white_user_id),
  CHECK ((winner IS NULL) = (reason = 'draw'))
);
CREATE INDEX IF NOT EXISTS matches_black_idx ON matches(black_user_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS matches_white_idx ON matches(white_user_id, finished_at DESC);
