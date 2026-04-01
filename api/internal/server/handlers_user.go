package server

import (
	"net/http"
	"regexp"

	"github.com/labstack/echo/v5"
	"github.com/podikoglou/my.fm/internal/api"
	"github.com/podikoglou/my.fm/internal/db/queries"
	serverauth "github.com/podikoglou/my.fm/internal/server/auth"
)

var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func validateUsername(username string) bool {
	if len(username) < 2 || len(username) > 30 {
		return false
	}
	return usernameRegex.MatchString(username)
}

func validateName(name string) bool {
	return len(name) > 0 && len(name) <= 50
}

// GetUser implements api.ServerInterface
func (h *Handler) GetUser(c *echo.Context) error {
	user, _ := serverauth.CurrentUser(c)

	onboarded := user.Onboarded.Valid && user.Onboarded.Int64 == 1

	return c.JSON(200, api.UserResponse{
		Id:        user.ID,
		Email:     user.Email,
		Name:      user.Name,
		Username:  user.Username,
		Onboarded: onboarded,
	})
}

// GetUsers implements api.ServerInterface
func (h *Handler) GetUsers(c *echo.Context, username string) error {
	if !validateUsername(username) {
		return c.JSON(400, api.GeneralError{Error: "invalid username"})
	}

	user, err := h.q.GetUserByUsername(c.Request().Context(), username)

	if err != nil {
		return c.JSON(404, api.GeneralError{Error: "user not found"})
	}

	return c.JSON(200, api.UsersResponse{
		Id:       user.ID,
		Name:     user.Username,
		Username: user.Name,
	})
}

// PutUserProfile implements api.ServerInterface
func (h *Handler) PutUserProfile(c *echo.Context) error {
	ctx := c.Request().Context()
	user, _ := serverauth.CurrentUser(c)

	// check if already onboarded
	if user.Onboarded.Valid && user.Onboarded.Int64 == 1 {
		return c.JSON(http.StatusBadRequest, api.GeneralError{Error: "already onboarded"})
	}

	var req api.PutUserProfileJSONBody
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, api.GeneralError{Error: "invalid data"})
	}

	errors := make(map[string]string)
	if !validateName(req.Name) {
		errors["name"] = "must be between 1 and 50 characters"
	}
	if !validateUsername(req.Username) {
		errors["username"] = "must be 2-30 characters and contain only letters, numbers, underscores, and hyphens"
	}

	// check if username is already taken
	existingUser, err := h.q.GetUserByUsername(ctx, req.Username)
	if err == nil && existingUser.ID != user.ID {
		errors["username"] = "already taken"
	}
	if len(errors) > 0 {
		return c.JSON(http.StatusBadRequest, api.FormError{Errors: errors})
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
