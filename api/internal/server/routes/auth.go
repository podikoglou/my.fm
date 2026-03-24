package routes

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
	gonanoid "github.com/matoous/go-nanoid/v2"
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
	serverauth "github.com/podikoglou/my.fm/internal/server/auth"
	"github.com/podikoglou/my.fm/internal/server/util"
	spotifyapi "github.com/zmb3/spotify/v2"
	spotifyauth "github.com/zmb3/spotify/v2/auth"
)

type AuthSpotifyRequest struct {
	Code string `json:"code"`
}

type AuthSpotifyResponse struct {
	AccessToken string `json:"accessToken"`
}

func AuthSpotifyHandler(cfg config.Config, q *queries.Queries, spotifyAuth *spotifyauth.Authenticator) func(c *echo.Context) error {
	return func(c *echo.Context) error {
		ctx := c.Request().Context()

		// read data
		var req AuthSpotifyRequest
		if err := c.Bind(&req); err != nil {
			return util.ErrorResp(c, http.StatusBadRequest, "invalid data")
		}

		if req.Code == "" {
			return util.ErrorResp(c, http.StatusBadRequest, "code required")
		}

		// exchange authorization code for access + refresh token
		token, err := spotifyAuth.Exchange(ctx, req.Code)
		if err != nil {
			return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
		}

		// create new client with the token
		client := spotifyapi.New(spotifyAuth.Client(ctx, token))

		// query user info
		me, err := client.CurrentUser(ctx)
		if err != nil {
			return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
		}

		user, err := getOrCreateUser(ctx, q, me.Email, me.DisplayName)
		if err != nil {
			return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
		}

		if err := updateUserSpotifyTokens(ctx, q, user.ID, token.AccessToken, token.RefreshToken, token.Expiry); err != nil {
			return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
		}

		jwtTokString, err := serverauth.IssueToken(cfg.Secret, user.ID, time.Now())
		if err != nil {
			return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
		}

		return c.JSON(http.StatusOK, AuthSpotifyResponse{AccessToken: jwtTokString})
	}
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
