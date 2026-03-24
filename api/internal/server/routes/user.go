package routes

import (
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
	"github.com/podikoglou/my.fm/internal/server/auth"
)

type UserMeResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Username  string `json:"username"`
	Onboarded bool   `json:"onboarded"`
}

func UserMeHandler(cfg config.Config, q *queries.Queries) func(c *echo.Context) error {
	return func(c *echo.Context) error {
		user, _ := auth.CurrentUser(c)

		return c.JSON(http.StatusOK, UserMeResponse{
			ID:        user.ID,
			Email:     user.Email,
			Name:      user.Name,
			Username:  user.Username,
			Onboarded: user.Onboarded.Valid && user.Onboarded.Int64 == 1,
		})
	}
}
