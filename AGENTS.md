# my.fm

A self-hosted last.fm clone. A Cloudflare Worker polls each user's Spotify
history on a schedule and stores it in D1. A second Worker serves the web app as
a single-page React Router build.

This is a Bun workspace. Use `bun` for every command.

For design, separation of concerns, typing, and testing skills, see .agents/skills/.
For the code style that the lint enforces, see docs/CODE-STYLE.md
For Vitest, Workers bindings and outbound request fixtures, see docs/TESTING.md
For deploy, stages and secrets, see docs/DEPLOYMENT.md
