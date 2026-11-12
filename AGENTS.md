# my.fm

A self-hosted last.fm clone. A Cloudflare Worker fetches each user's Spotify
history every five minutes and stores it in D1. A second Worker serves the web
app as a single-page React Router build.

This is a Bun workspace. Use `bun` for every command.

For the code style that the lint enforces, see docs/CODE-STYLE.md
For tests and the database harness, see docs/TESTING.md
For deploy, stages and secrets, see docs/DEPLOYMENT.md
