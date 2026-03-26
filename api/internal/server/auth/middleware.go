package auth

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	echojwt "github.com/labstack/echo-jwt/v5"
	"github.com/labstack/echo/v5"
	"github.com/podikoglou/my.fm/internal/api"
	"github.com/podikoglou/my.fm/internal/db/queries"
)

const (
	jwtContextKey         = "user"
	currentUserContextKey = "current_user"
)

func IsPublicPath(path string) bool {
	return strings.HasPrefix(path, "/auth")
}

func JWTMiddleware(secret string) echo.MiddlewareFunc {
	return echojwt.WithConfig(echojwt.Config{
		Skipper: func(c *echo.Context) bool {
			return IsPublicPath(c.Request().URL.Path)
		},
		ContextKey:    jwtContextKey,
		SigningKey:    []byte(secret),
		SigningMethod: jwt.SigningMethodHS256.Alg(),
		TokenLookup:   "header:Authorization:Bearer ",
		NewClaimsFunc: func(c *echo.Context) jwt.Claims {
			return new(jwt.RegisteredClaims)
		},
		ErrorHandler: func(c *echo.Context, err error) error {
			return c.JSON(http.StatusUnauthorized, api.GeneralError{Error: "unauthorized"})
		},
	})
}

func CurrentUserMiddleware(q *queries.Queries) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			if IsPublicPath(c.Request().URL.Path) {
				return next(c)
			}

			claims, ok := ClaimsFromContext(c)
			if !ok || claims.Subject == "" {
				return c.JSON(http.StatusUnauthorized, api.GeneralError{Error: "unauthorized"})
			}

			user, err := q.GetUserById(c.Request().Context(), claims.Subject)
			if err != nil {
				if err == sql.ErrNoRows {
					return c.JSON(http.StatusUnauthorized, api.GeneralError{Error: "unauthorized"})
				}

				return c.JSON(http.StatusInternalServerError, api.GeneralError{Error: err.Error()})
			}

			c.Set(currentUserContextKey, user)
			return next(c)
		}
	}
}

func ClaimsFromContext(c *echo.Context) (*jwt.RegisteredClaims, bool) {
	rawToken := c.Get(jwtContextKey)
	token, ok := rawToken.(*jwt.Token)
	if !ok || token == nil {
		return nil, false
	}

	claims, ok := token.Claims.(*jwt.RegisteredClaims)
	if !ok || claims == nil {
		return nil, false
	}

	return claims, true
}

func CurrentUser(c *echo.Context) (queries.User, bool) {
	user, ok := c.Get(currentUserContextKey).(queries.User)
	return user, ok
}
