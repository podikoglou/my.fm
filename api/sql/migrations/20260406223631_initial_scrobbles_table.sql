-- +goose Up
CREATE TABLE scrobbles(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  spotify_uri TEXT NOT NULL
);

-- +goose Down
DROP TABLE scrobbles;
