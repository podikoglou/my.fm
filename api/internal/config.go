// This file contains code for reading environment variables into a Config struct.
package config

import (
	"log"
	"os"
)

type Config struct {
	Spotify SpotifyConfig
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
		ClientId:     getEnvRequired("SPOTIFY_CLIEN_ID"),
		ClientSecret: getEnvRequired("SPOTIFY_CLIEN_SECRET"),
	}
}

func ParseConfig() Config {
	return Config{
		Spotify: parseSpotifyConfig(),
	}
}
