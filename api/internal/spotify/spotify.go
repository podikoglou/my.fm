package spotify

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/podikoglou/my.fm/internal/config"
)

const tokenURL = "https://accounts.spotify.com/api/token"
const meURL = "https://api.spotify.com/v1/me"

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
}

type MeResponse struct {
	DisplayName string            `json:"display_name"`
	Email       string            `json:"email"`
	Id          string            `json:"id"`
	Images      []MeResponseImage `json:"images"`
	// there's also explicit_content, not sure if we need it really.
	// though would be nice, so we can store it and hide explicit content.
	// but that';s too much. maybe in the future.
}

type MeResponseImage struct {
	Url    string `json:"url"`
	Height int    `json:"height"`
	Width  int    `json:"width"`
}

func ExchangeToken(code, redirectUri string, cfg config.SpotifyConfig) (TokenResponse, error) {
	// set up the payload
	data := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"redirect_uri": {redirectUri},
	}

	// construct request
	req, err := http.NewRequest(http.MethodPost, tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return TokenResponse{}, fmt.Errorf("failed to create request: %w", err)
	}

	creds := base64.StdEncoding.EncodeToString([]byte(cfg.ClientId + ":" + cfg.ClientSecret))
	req.Header = http.Header{
		"Content-Type":  {"application/x-www-form-urlencoded"},
		"Authorization": {"Basic " + creds},
	}

	// send request
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return TokenResponse{}, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return TokenResponse{}, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return TokenResponse{}, fmt.Errorf("failed to decode response: %w", err)
	}

	return tokenResp, nil
}

func Me(accessToken string) (MeResponse, error) {
	// construct request
	req, err := http.NewRequest(http.MethodGet, meURL, nil)
	if err != nil {
		return MeResponse{}, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header = http.Header{
		"Authorization": {"Bearer " + accessToken},
	}

	// send request
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return MeResponse{}, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return MeResponse{}, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var meResp MeResponse
	if err := json.NewDecoder(resp.Body).Decode(&meResp); err != nil {
		return MeResponse{}, fmt.Errorf("failed to decode response: %w", err)
	}

	return meResp, nil
}
