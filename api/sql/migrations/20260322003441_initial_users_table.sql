-- +goose Up
CREATE TABLE users (
  id                       TEXT PRIMARY KEY,
  username                 TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  email                    TEXT NOT NULL UNIQUE,

  spotify_access_token     TEXT,
  spotify_refresh_token    TEXT,
  spotify_token_expiration INTEGER,

  created_at               TEXT NOT NULL DEFAULT (unixepoch()),

  onboarded                INTEGER
);

-- +goose Down
DROP TABLE users;
