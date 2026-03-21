package main

import (
	"log"

	"github.com/joho/godotenv"
	config "github.com/podikoglou/my.fm/internal"
	"github.com/podikoglou/my.fm/internal/server"
)

func main() {
	// load env variables
	err := godotenv.Load()
	if err != nil {
		log.Fatal("error: couldn't load .env file")
	}

	config := config.ParseConfig()

	// start server
	log.Fatal(server.StartServer(":8080"))
}
