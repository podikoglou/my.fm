package main

import (
	"log"

	"github.com/podikoglou/my.fm/internal/server"
)

func main() {
	log.Fatal(server.StartServer(":8080"))
}
