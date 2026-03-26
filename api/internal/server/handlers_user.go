package server

import (
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/podikoglou/my.fm/internal/api"
	"github.com/podikoglou/my.fm/internal/db/queries"
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

// UserOnboarding implements api.ServerInterface
func (h *Handler) UserOnboarding(c *echo.Context) error {
	ctx := c.Request().Context()
	user, _ := serverauth.CurrentUser(c)

	// check if already onboarded
	if user.Onboarded.Valid && user.Onboarded.Int64 == 1 {
		return c.JSON(http.StatusConflict, api.GeneralError{Error: "already onboarded"})
	}

	var req api.UserOnboardingJSONBody
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, api.GeneralError{Error: "invalid data"})
	}

	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, api.FormError{Errors: map[string]string{"name": "name is required"}})
	}
	if req.Username == "" {
		return c.JSON(http.StatusBadRequest, api.FormError{Errors: map[string]string{"username": "username is required"}})
	}

	if err := h.q.OnboardUser(ctx, queries.OnboardUserParams{
		Username: req.Username,
		Name:     req.Name,
		ID:       user.ID,
	}); err != nil {
		return c.JSON(http.StatusInternalServerError, api.GeneralError{Error: err.Error()})
	}

	return c.NoContent(204)
}
