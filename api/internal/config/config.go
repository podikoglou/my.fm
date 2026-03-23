// This file contains code for reading environment variables into a Config struct.
package config

import (
	"log"
	"os"
)

type Config struct {
	RedirectUri  string
	Spotify      SpotifyConfig
	DatabasePath string
	Secret       string
}

type SpotifyConfig struct {
	ClientId     string
	ClientSecret string
}

// NOTE: This panics. That's fine because it's used in exactly one place in the
// codebase, which is in this module, and the code that calls this is only
// called during initialization.
func getEnvRequired(name string) string {
	val, found := os.LookupEnv(name)
	if !found {
		log.Fatalf("error: couldn't find environment variable %s", name)
	}

	return val
}

func parseSpotifyConfig() SpotifyConfig {
	return SpotifyConfig{
		ClientId:     getEnvRequired("SPOTIFY_CLIENT_ID"),
		ClientSecret: getEnvRequired("SPOTIFY_CLIENT_SECRET"),
	}
}

func ParseConfig() Config {
	return Config{
		RedirectUri:  getEnvRequired("REDIRECT_URI"),
		Spotify:      parseSpotifyConfig(),
		DatabasePath: getEnvRequired("DATABASE_PATH"),
		Secret:       getEnvRequired("SECRET"),
	}
}
