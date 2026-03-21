package server

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
	"github.com/podikoglou/my.fm/internal/server/routes"
	"github.com/rs/cors"
)

func StartServer(addr string, cfg config.Config, q *queries.Queries) error {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /auth/spotify", routes.AuthSpotifyHandler(cfg, q))

	handler := cors.Default().Handler(mux)

	slog.Info(fmt.Sprintf("Starting HTTP server on %s", addr))
	return http.ListenAndServe(addr, handler)
}
