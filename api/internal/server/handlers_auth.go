package server

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
	gonanoid "github.com/matoous/go-nanoid/v2"
	"github.com/podikoglou/my.fm/internal/api"
	"github.com/podikoglou/my.fm/internal/db/queries"
	serverauth "github.com/podikoglou/my.fm/internal/server/auth"
	spotifyapi "github.com/zmb3/spotify/v2"
)

// AuthSpotify implements api.ServerInterface
func (h *Handler) AuthSpotify(c *echo.Context) error {
	ctx := c.Request().Context()

	// read data
	var req api.AuthSpotifyJSONBody
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, api.GeneralError{Error: "invalid data"})
	}

	if req.Code == "" {
		return c.JSON(http.StatusBadRequest, api.GeneralError{Error: "code required"})
	}

	// exchange authorization code for access + refresh token
	token, err := h.spotifyAuth.Exchange(ctx, req.Code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, api.GeneralError{Error: err.Error()})
	}

	// create new client with the token
	client := spotifyapi.New(h.spotifyAuth.Client(ctx, token))

	// query user info
	me, err := client.CurrentUser(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, api.GeneralError{Error: err.Error()})
	}

	user, err := getOrCreateUser(ctx, h.q, me.Email, me.DisplayName)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, api.GeneralError{Error: err.Error()})
	}

	if err := updateUserSpotifyTokens(ctx, h.q, user.ID, token.AccessToken, token.RefreshToken, token.Expiry); err != nil {
		return c.JSON(http.StatusInternalServerError, api.GeneralError{Error: err.Error()})
	}

	jwtTokString, err := serverauth.IssueToken(h.cfg.Secret, user.ID, time.Now())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, api.GeneralError{Error: err.Error()})
	}

	return c.JSON(http.StatusOK, api.AuthSpotifyResponse{AccessToken: jwtTokString})
}

func getOrCreateUser(ctx context.Context, q *queries.Queries, email string, displayName string) (queries.User, error) {
	user, err := q.GetUserByEmail(ctx, email)
	if err == nil {
		return user, nil
	}

	if err != sql.ErrNoRows {
		return queries.User{}, err
	}

	id, err := gonanoid.New()
	if err != nil {
		return queries.User{}, err
	}

	return q.CreateUser(ctx, queries.CreateUserParams{
		ID:       id,
		Username: id,
		Name:     displayName,
		Email:    email,
	})
}

func updateUserSpotifyTokens(ctx context.Context, q *queries.Queries, userID string, accessToken string, refreshToken string, expiry time.Time) error {
	return q.UpdateUserSpotifyTokens(ctx, queries.UpdateUserSpotifyTokensParams{
		SpotifyAccessToken:     sql.NullString{String: accessToken, Valid: accessToken != ""},
		SpotifyRefreshToken:    sql.NullString{String: refreshToken, Valid: refreshToken != ""},
		SpotifyTokenExpiration: sql.NullInt64{Int64: expiry.Unix(), Valid: !expiry.IsZero()},
		ID:                     userID,
	})
}
