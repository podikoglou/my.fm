package routes

import (
	"database/sql"
	"net/http"

	"github.com/golang-jwt/jwt/v4"
	"github.com/labstack/echo/v5"
	gonanoid "github.com/matoous/go-nanoid/v2"
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
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

		// GENERAL FLOW:

		// 1. figure out if user already exists by their email

		// --------------------------------------------------------------------------
		// USER EXISTS:
		// 1. create JWT
		// 2. respond wiht JWT
		// --------------------------------------------------------------------------

		// --------------------------------------------------------------------------
		// USER DOES NOT EXIST:
		// 1. create user (by default, it should have a column "onboarded" to false)
		// 2. create JWT
		// 3. respond wih JWT
		//
		// - there should be a middleware that checks if the user is authenticated
		// - there should be a middleware that checks if the user is onboarded
		// - if the user is not onboarded, the client should be informed and
		//   redirect to an onboarding page
		// - in the onboarding page he user should enter their name and username
		//   (and in the future proflie picure)
		// --------------------------------------------------------------------------

		user, err := q.GetUserByEmail(ctx, me.Email)

		if err != nil {
			if err != sql.ErrNoRows {
				return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
			}

			// create user if they don't exist
			id, err := gonanoid.New()
			if err != nil {
				return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
			}

			user, err = q.CreateUser(ctx, queries.CreateUserParams{
				ID:       id,
				Username: id, // until the user picks a username, we default it to the ID
				Name:     me.DisplayName,
				Email:    me.Email,
			})

			if err != nil {
				return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
			}

		}

		// update token
		if err := q.UpdateUserSpotifyTokens(ctx, queries.UpdateUserSpotifyTokensParams{
			SpotifyAccessToken:     sql.NullString{String: token.AccessToken, Valid: token.AccessToken != ""},
			SpotifyRefreshToken:    sql.NullString{String: token.RefreshToken, Valid: token.RefreshToken != ""},
			SpotifyTokenExpiration: sql.NullInt64{Int64: token.Expiry.Unix(), Valid: !token.Expiry.IsZero()},
			ID:                     user.ID,
		}); err != nil {
			return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
		}

		// TODO: expiration?
		t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"sub": user.ID,
		})

		signed, err := t.SignedString([]byte(cfg.Secret))

		if err != nil {
			return util.ErrorResp(c, http.StatusInternalServerError, err.Error())
		}

		return c.JSON(http.StatusOK, AuthSpotifyResponse{AccessToken: signed})
	}
}
