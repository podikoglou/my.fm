package server

import (
	"github.com/labstack/echo/v5"
	"github.com/podikoglou/my.fm/internal/api"
	serverauth "github.com/podikoglou/my.fm/internal/server/auth"
)

// UserMe implements api.ServerInterface
func (h *Handler) UserMe(c *echo.Context) error {
	user, _ := serverauth.CurrentUser(c)

	onboarded := user.Onboarded.Valid && user.Onboarded.Int64 == 1

	return c.JSON(200, api.UserMeResponse{
		Id:        user.ID,
		Email:     user.Email,
		Name:      user.Name,
		Username:  user.Username,
		Onboarded: onboarded,
	})
}
