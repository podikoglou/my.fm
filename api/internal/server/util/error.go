package util

import "github.com/labstack/echo/v5"

type APIError struct {
	Error string `json:"message"`
}

func ErrorResp(c *echo.Context, status int, msg string) error {
	return c.JSON(status, map[string]any{
		"error": APIError{Error: msg},
	})
}
