package util

import "github.com/labstack/echo/v5"

type APIError struct {
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

type APIErrorResponse struct {
	Error APIError `json:"error"`
}

func ErrorResp(c *echo.Context, status int, msg string) error {
	return c.JSON(status, APIErrorResponse{
		Error: APIError{Message: msg},
	})
}

func ValidationErrorResp(c *echo.Context, status int, errors map[string]string) error {
	return c.JSON(status, APIErrorResponse{
		Error: APIError{
			Message: "invalid input",
			Fields:  errors,
		},
	})
}
