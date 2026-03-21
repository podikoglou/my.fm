package server

import (
	"fmt"
	"log/slog"
	"net/http"
)

func StartServer(addr string) error {
	slog.Info(fmt.Sprintf("Starting Http server on %s", addr))
	return http.ListenAndServe(addr, nil)
}
