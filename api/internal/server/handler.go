package server

import (
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
	spotifyauth "github.com/zmb3/spotify/v2/auth"
)

type Handler struct {
	cfg         config.Config
	q           *queries.Queries
	spotifyAuth *spotifyauth.Authenticator
}

func NewHandler(cfg config.Config, q *queries.Queries, spotifyAuth *spotifyauth.Authenticator) *Handler {
	return &Handler{
		cfg:         cfg,
		q:           q,
		spotifyAuth: spotifyAuth,
	}
}
