# Who's the Spy — Agent Instructions

## Project

Real-time multiplayer social deduction game. Players get similar words; one player (the imposter) gets a slightly different word. Players describe their word in turns, then vote to identify the imposter.

Stack: Node.js, Express, Socket.io, vanilla JS frontend (no build step).

## Local Dev Setup

Node is managed via nvm (zsh). Always run before starting:

```sh
nvm use 24
npm start
```

Server runs on `http://localhost:3000`.

## Key Files

- [src/server.js](src/server.js) — Express + Socket.io entry point
- [src/game-manager.js](src/game-manager.js) — Core game logic and state machine
- [src/word-pairs.js](src/word-pairs.js) — Word pair database
- [public/client.js](public/client.js) — Shared client utilities, session management
- [public/game.html](public/game.html) — Main game UI
- [public/index.html](public/index.html) — Landing page

## Architecture

- **State machine phases**: `lobby → description → voting → results → ended`
- **Client state**: derived entirely from server pushes (`game-state-update` event)
- **Session**: stored in `sessionStorage` as `{ gameCode, playerId, playerName }`
- **Reconnection**: 60s grace period; player auto-restored on next action

## Commands

```sh
npm start                    # Run server
npm test                     # Unit tests (game logic, no server needed)
npm run simulate             # Socket.io simulation — requires server running
SCENARIO=tie-vote npm run simulate  # Run a specific scenario
```

## Releases

Releases are fully automated via **release-please**. Never bump versions manually.

Use **Conventional Commits** in every commit message:

| Prefix | Effect | Example |
|--------|--------|---------|
| `fix:` | patch bump (1.1.x) | `fix: tie vote not resolving correctly` |
| `feat:` | minor bump (1.x.0) | `feat: add spectator mode` |
| `feat!:` or `BREAKING CHANGE:` | major bump (x.0.0) | `feat!: redesign game API` |
| `chore:`, `docs:`, `test:` | no release | `chore: update dependencies` |

**Flow:** merge to `main` → release-please opens/updates a Release PR → merge the Release PR → GitHub Release + git tag created automatically.

## CI / Branch Protection

- All PRs to `main` must pass the `test` CI job before merging
- Force pushes and branch deletion are blocked on `main`

## Deployment

Deployed via Coolify on a VPS using nixpacks (no Dockerfile). Designed for Cloudflare-proxied environments — uses WebSocket-only transport (no polling fallback).
