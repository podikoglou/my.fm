package server

import (
	"fmt"
	"log/slog"

	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
	apiauth "github.com/podikoglou/my.fm/internal/server/auth"
	"github.com/podikoglou/my.fm/internal/server/routes"
	spotifyauth "github.com/zmb3/spotify/v2/auth"
)

func StartServer(addr string, cfg config.Config, q *queries.Queries, spotifyAuth *spotifyauth.Authenticator) error {
	e := echo.New()
	e.Use(middleware.RequestLogger())
	e.Use(middleware.CORS("https://my.fm"))
	e.Use(apiauth.JWTMiddleware(cfg.Secret))
	e.Use(apiauth.CurrentUserMiddleware(q))

	e.POST("/auth/spotify", routes.AuthSpotifyHandler(cfg, q, spotifyAuth))
	e.GET("/user/me", routes.UserMeHandler(cfg, q))
	e.POST("/user/onboard", routes.UserOnboardHandler(cfg, q))

	slog.Info(fmt.Sprintf("Starting HTTP server on %s", addr))
	return e.Start(addr)
}
