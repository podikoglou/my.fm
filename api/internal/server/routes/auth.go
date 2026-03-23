package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/golang-jwt/jwt/v4"
	gonanoid "github.com/matoous/go-nanoid/v2"
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
	"github.com/podikoglou/my.fm/internal/spotify"
)

type AuthSpotifyRequest struct {
	Code string `json:"code"`
}

type AuthSpotifyResponse struct {
	AccessToken string `json:"accessToken"`
}

func AuthSpotifyHandler(cfg config.Config, q *queries.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// read request
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}

		// validate request
		var req AuthSpotifyRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "failed to parse request body", http.StatusBadRequest)
			return
		}

		if req.Code == "" {
			http.Error(w, "code is required", http.StatusBadRequest)
			return
		}

		// exchange authorization code for access + refresh token
		tokenResp, err := spotify.ExchangeToken(req.Code, cfg.RedirectUri, cfg.Spotify)
		if err != nil {
			slog.Error(fmt.Sprintf("failed to exchange token: %v", err))
			http.Error(w, "failed to exchange token", http.StatusInternalServerError)
			return
		}

		// query user info
		me, err := spotify.Me(tokenResp.AccessToken)
		if err != nil {
			slog.Error(fmt.Sprintf("failed to query user information: %v", err))
			http.Error(w, "failed to query user information", http.StatusInternalServerError)
			return
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

		user, err := q.GetUserByEmail(r.Context(), me.Email)

		if err != nil {
			// create user if they don't exist
			id, err := gonanoid.New()
			if err != nil {
				slog.Error(fmt.Sprintf("failed to generate id: %v", err))
				http.Error(w, "failed to generate id", http.StatusInternalServerError)
				return
			}

			user, err = q.CreateUser(r.Context(), queries.CreateUserParams{
				ID:       id,
				Username: id, // until the user picks a username, we default it to the ID
				Name:     me.DisplayName,
				Email:    me.Email,
			})

			if err != nil {
				slog.Error(fmt.Sprintf("failed to create user: %v", err))
				http.Error(w, "failed to create user", http.StatusInternalServerError)
				return
			}
		}

		// TODO: expiration?
		t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"sub": user.ID,
		})

		signed, err := t.SignedString([]byte(cfg.Secret))

		if err != nil {
			slog.Error(fmt.Sprintf("failed to sign JWT: %v", err))
			http.Error(w, "failed to sign JWT", http.StatusInternalServerError)
			return
		}

		resp := AuthSpotifyResponse{AccessToken: signed}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}
