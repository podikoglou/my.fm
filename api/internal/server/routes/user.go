package routes

import (
	"errors"
	"net/http"
	"regexp"

	"github.com/labstack/echo/v5"
	"github.com/podikoglou/my.fm/internal/config"
	"github.com/podikoglou/my.fm/internal/db/queries"
	"github.com/podikoglou/my.fm/internal/server/auth"
	"github.com/podikoglou/my.fm/internal/server/util"
)

type UserMeResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Username  string `json:"username"`
	Onboarded bool   `json:"onboarded"`
}

type UserOnboardRequest struct {
	Name     string `json:"name"`
	Username string `json:"username"`
}

type UserOnboardSuccessResponse struct {
	Ok bool `json:"ok"`
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

func UserOnboardHandler(cfg config.Config, q *queries.Queries) func(c *echo.Context) error {
	return func(c *echo.Context) error {
		user, _ := auth.CurrentUser(c)

		ctx := c.Request().Context()

		// read data
		var req UserOnboardRequest
		if err := c.Bind(&req); err != nil {
			return util.ErrorResp(c, http.StatusBadRequest, "invalid data")
		}

		// validate data
		if err := validateName(req.Name); err != nil {
			return util.ValidationErrorResp(c, http.StatusBadRequest, map[string]string{"name": err.Error()})
		}

		// validate data
		if err := validateUsername(req.Username); err != nil {
			return util.ValidationErrorResp(c, http.StatusBadRequest, map[string]string{"username": err.Error()})
		}

		// update db
		if err := q.OnboardUser(ctx, queries.OnboardUserParams{
			Username: req.Username,
			Name:     req.Name,
			ID:       user.ID,
		}); err != nil {
			return util.ErrorResp(c, http.StatusInternalServerError, "could not complete onboarding")
		}

		return c.JSON(http.StatusOK, UserOnboardSuccessResponse{Ok: true})
	}
}

func validateName(name string) error {
	if len(name) < 1 {
		return errors.New("must at least 1 character")
	}

	if len(name) > 32 {
		return errors.New("must be less than 32 characters")
	}

	return nil
}

func validateUsername(username string) error {
	match, err := regexp.MatchString("^[a-zA-Z0-9_]{2,16}$", username)
	if err != nil {
		return err
	}

	if !match {
		return errors.New("must contain no special characters and be between 2 to 16 characters")
	}

	return nil
}
