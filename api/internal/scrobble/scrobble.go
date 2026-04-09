// This package is concerned with scrobbling (logging the play of a track). It
// particularly takes care of inserting the scrobble into the database and
// anything else that should happen when recording a scrobble (in the future,
// perhaps posting to webhooks, etc.)
package scrobble

import (
	"context"
	"strconv"
	"time"

	gonanoid "github.com/matoous/go-nanoid/v2"
	"github.com/podikoglou/my.fm/internal/db/queries"
)

func RecordScrobble(context context.Context, q *queries.Queries, user queries.User, spotifyUri string, date time.Time) (queries.Scrobble, error) {
	// create id for the scrobble
	id, err := gonanoid.New()
	if err != nil {
		return queries.Scrobble{}, err
	}

	// get the current unix timestamp in seconds
	now := strconv.FormatInt(time.Now().Unix(), 10)

	return q.CreateScrobble(context, queries.CreateScrobbleParams{
		ID:         id,
		UserID:     user.ID,
		CreatedAt:  now,
		SpotifyUri: spotifyUri,
	})
}
