package main

import (
	"log"

	"github.com/joho/godotenv"
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db"
	"github.com/podikoglou/my.fm/internal/db/queries"
	"github.com/podikoglou/my.fm/internal/server"
	spotifyauth "github.com/zmb3/spotify/v2/auth"
)

func main() {
	// load env variables
	err := godotenv.Load()
	if err != nil {
		log.Fatalf("error: couldn't load .env file: %s", err)
	}

	cfg := config.ParseConfig()

	// open database
	db, err := db.OpenSQLite(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("error: couldn't open database: %s", err)
	}
	defer db.Close()

	queries := queries.New(db)

	// create spotify client

	spotifyAuth := spotifyauth.New(
		spotifyauth.WithClientID(cfg.Spotify.ClientId),
		spotifyauth.WithClientSecret(cfg.Spotify.ClientSecret),
		spotifyauth.WithRedirectURL(cfg.RedirectUri),
		spotifyauth.WithScopes(
			spotifyauth.ScopeUserReadPrivate,
			spotifyauth.ScopeUserReadEmail,
		),
	)

	// start server
	log.Fatal(server.StartServer(":8080", cfg, queries, spotifyAuth))
}
