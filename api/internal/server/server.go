package server

import (
	"fmt"
	"log/slog"

	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
	"github.com/podikoglou/my.fm/internal/server/routes"
)

func StartServer(addr string, cfg config.Config, q *queries.Queries) error {
	e := echo.New()
	e.Use(middleware.RequestLogger())
	e.Use(middleware.CORS("https://my.fm"))

	e.POST("/auth/spotify", routes.AuthSpotifyHandler(cfg, q))

	slog.Info(fmt.Sprintf("Starting HTTP server on %s", addr))
	return e.Start(addr)
}
