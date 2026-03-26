-- name: GetUserById :one
SELECT * FROM users
WHERE id = ?
LIMIT 1;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = ?
LIMIT 1;

-- name: GetUserByUsername :one
SELECT * FROM users
WHERE username = ?
LIMIT 1;

-- name: CreateUser :one
INSERT INTO users (
  id, username, name, email, onboarded
) VALUES (
  ?, ?, ?, ?, FALSE
)
RETURNING *;

-- name: UpdateUserSpotifyTokens :exec
UPDATE users
set spotify_access_token = ?,
    spotify_refresh_token = ?,
    spotify_token_expiration = ?
WHERE id = ?;

-- name: OnboardUser :exec
UPDATE users
set username = ?,
    name = ?,
    onboarded = true
WHERE id = ?;
