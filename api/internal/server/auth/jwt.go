package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const TokenTTL = 72 * time.Hour

func NewClaims(userID string, now time.Time) jwt.RegisteredClaims {
	return jwt.RegisteredClaims{
		Subject:   userID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(TokenTTL)),
	}
}

func IssueToken(secret string, userID string, now time.Time) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, NewClaims(userID, now))
	return token.SignedString([]byte(secret))
}
