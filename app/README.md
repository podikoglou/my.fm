# my.fm web app

The my.fm web app.

The my.fm web application. It is a React Router 7 single-page app, built with
Vite and served by a Cloudflare Worker.

## Stack

- React on Vite
- React Router 7
- React Query

The app talks to the API using Hono RPC.

## Routes

`app/routes.ts` declares the pages. The shared layout renders the signed-in
user's unacknowledged notifications above every page.

| Path                 | Page                                                        |
| -------------------- | ----------------------------------------------------------- |
| `/`                  | Redirects to the feed                                       |
| `/feed`              | The latest scrobbles from everyone                          |
| `/settings`          | Profile settings and history import; requires a session     |
| `/user/:username`    | A user's profile and history                                |
| `/onboard`           | Name and username for a new user                            |
| `/notifications/:id` | Acknowledges the notification, signs out and starts sign-in |
| `/auth/error`        | Explains a failed Spotify sign-in                           |
