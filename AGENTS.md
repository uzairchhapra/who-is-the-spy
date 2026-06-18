# Who's the Spy - Agent Instructions

## Project

Real-time multiplayer social deduction game. Players join a room, receive secret words, describe their word in turn order, then vote to identify the imposter. Civilians share one word; the imposter receives a similar but different word.

Stack: Node.js 24, Express, Socket.io, vanilla HTML/CSS/JS. There is no frontend build step.

## Local Dev Setup

Node is managed with `nvm` in zsh. Before running the app:

```sh
nvm use 24
npm start
```

The server runs at `http://localhost:3000`.

Install dependencies with `npm ci` when setting up a fresh checkout.

## Key Files

- [src/server.js](src/server.js) - Express and Socket.io entry point, static routes, socket event handlers.
- [src/game-manager.js](src/game-manager.js) - Core game state, player lifecycle, rounds, turns, votes, win conditions.
- [src/word-pairs.js](src/word-pairs.js) - In-memory civilian/imposter word pair list.
- [public/client.js](public/client.js) - Shared Socket.io client setup, sessionStorage helpers, reconnect behavior.
- [public/index.html](public/index.html) - Landing page for create/join and invite-link auto-join.
- [public/lobby.html](public/lobby.html) - Lobby UI, host controls, player list, share link, name editing.
- [public/game.html](public/game.html) - Main game UI, phase rendering, clues, voting, results, chat.
- [public/styles.css](public/styles.css) - Dark UI theme and component styles.
- [tests/game-manager.test.js](tests/game-manager.test.js) - Node unit tests for game logic without a server.
- [tests/simulate-game.js](tests/simulate-game.js) - Socket.io multi-player simulation; this is the key integration test.
- [docs/TECHNICAL.md](docs/TECHNICAL.md) - Broader architecture notes, but verify details against code before relying on it.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) - CI runs `npm test` on Node 24.
- [.github/workflows/release.yml](.github/workflows/release.yml) - release-please automation.

## Runtime Model

- `GameManager` owns all authoritative state in memory: `games`, `playerSessions`, deletion timers.
- `server.js` maps socket events to `GameManager` methods and emits full game snapshots.
- Clients derive UI from server pushes, primarily `game-state-update`, with small local UI-only state such as selected vote.
- Socket.io is WebSocket-only on both server and client for Cloudflare/proxy compatibility. Do not add polling fallback unless deliberately changing deployment assumptions.
- Static HTML/JS/CSS responses are served with no-cache headers, so there is no bundler or asset pipeline to update.

## State Machine

There are two related state fields:

- `game.status`: broad server lifecycle: `lobby`, `playing`, `ended`.
- `game.gamePhase`: UI/gameplay phase: `lobby`, `description`, `voting`, `results`, `ended`.

Normal flow:

```text
lobby -> description -> voting -> results -> description ... -> ended
```

Important behavior:

- Starting requires the creator and at least 3 players.
- Roles and words are assigned only at round 1. Later rounds keep roles and words.
- Each round resets `hasDescribed`, `hasVoted`, `votes`, `lastRoundResult`, and shuffles `turnOrder`.
- Description is turn-based. Only `turnOrder[currentTurnIndex]` may submit.
- Voting completes when every active or disconnected in-game player has voted.
- A tie or winning `none` vote eliminates nobody and proceeds to another round after a 5 second server timer.
- Civilians win if the imposter is eliminated or confirmed disconnected after the grace window.
- The imposter wins if only one civilian remains capable of continuing.

## Player Lifecycle

Player statuses:

- `active` - playing or present in lobby.
- `waiting` - joined during an active game; shown as spectator/waiting and included in the next new game.
- `disconnected` - socket dropped but the player may return within the grace period.
- `eliminated` - voted out and no longer participates.

Reconnection details:

- The browser stores `{ gameCode, playerId, playerName }` in `sessionStorage`.
- On `/lobby` and `/game`, `public/client.js` re-emits `join-game` on every socket `connect` when a saved session exists.
- `joinGame(gameCode, socketId, playerName, previousPlayerId)` restores the same player when `previousPlayerId` exists in that game. The server does not require the submitted name to match, because mobile reconnects and duplicate-name suffixes can send stale names.
- If a reconnect creates a new socket before the old socket closes, `leaveGame` must not mark the player disconnected while another session exists for the same `gameCode` and `playerId`.
- Lobby disconnects and in-game disconnects both use a 60 second grace timer in the current implementation.
- Empty games are scheduled for deletion after 5 minutes.
- Disconnected players still count for description turn order and voting until the grace handling resolves, so tests should cover those paths carefully.

## Socket Event Contract

Client to server:

- `create-game` with `{ playerName }`
- `join-game` with `{ gameCode, playerName, previousPlayerId? }`
- `start-game` with `{ gameCode }`
- `submit-description` with `{ gameCode, description }`
- `submit-vote` with `{ gameCode, votedPlayerId }`
- `send-chat` with `{ gameCode, message }`
- `start-new-game` with `{ gameCode }`
- `update-player-name` with `{ gameCode, newName }`

Server to client:

- `game-created` with `{ gameCode, playerId }`
- `game-joined` with `{ gameCode, playerId, gameState }`
- `game-started` with `game`
- `game-state-update` with `game`
- `player-update` with `players` after create only
- `chat-message` with `{ sender, message, timestamp, type }`
- `player-name-updated` with `{ playerId, oldName, newName }`
- `error` with `{ message }`

When changing event payloads, update the server, all three public HTML pages, `public/client.js`, and the simulation helpers together.

## Testing Expectations

Always run unit tests for game logic changes:

```sh
npm test
```

For multiplayer, socket, reconnection, invite-link, voting, or UI-flow changes, also run the simulation. It replaces manually opening several browser tabs.

Terminal 1:

```sh
nvm use 24
npm start
```

Terminal 2:

```sh
nvm use 24
npm run simulate
```

Run a focused scenario with:

```sh
SCENARIO=happy-path npm run simulate
SCENARIO=imposter-wins npm run simulate
SCENARIO=tie-vote npm run simulate
SCENARIO=reconnect npm run simulate
SCENARIO=mobile-suspend npm run simulate
SCENARIO=duplicate-refresh npm run simulate
SCENARIO=simultaneous-renames npm run simulate
```

`tests/simulate-game.js` defaults to `SERVER_URL=http://localhost:3000`. Use `SERVER_URL=https://... npm run simulate` only when intentionally validating a deployed environment.

## Simulation Guidance

The simulation is the most important test surface for this game because correctness depends on multiple independent sockets receiving and emitting state in order.

When adding or editing simulation scenarios:

- Use `socket.io-client` with `transports: ['websocket']`.
- Register `waitForEvent` or `waitForGameState` before emitting the action that should trigger it. Fast server responses can otherwise be missed.
- Drive each player through their own socket; do not shortcut by mutating server state.
- Keep per-player fields in sync: `name`, `socket`, `playerId`, `gameCode`, `gameState`.
- Use `runDescriptions` to submit clues in `game.turnOrder`.
- Use `runVotes` or explicit votes to test win/loss/tie behavior.
- Call `disconnectAll(players)` at the end of every scenario so a later scenario starts cleanly.
- Add regression scenarios for bugs involving reconnect, mobile tab suspension, invite links, duplicate names, waiting spectators, tie votes, `none` votes, or disconnected players in turn/vote counts.

Existing scenarios:

- `happy-path` - 4 players, civilians vote out imposter.
- `imposter-wins` - 3 players, civilians vote out a civilian.
- `tie-vote` - 4 players tie round 1, wait for auto round 2, then civilians win.
- `reconnect` - player drops after start, rejoins with same `previousPlayerId`, then game completes.
- `mobile-suspend` - creator socket drops while sharing invite, reconnects with saved session, other players see status restore.
- `duplicate-refresh` - duplicate names plus stale-name refresh restore the same player instead of creating `Paul (2)`.
- `simultaneous-renames` - several players rename at nearly the same time; server emits unique canonical names to everyone.

## Frontend Notes

- Keep frontend changes framework-free unless the project is intentionally migrated.
- Shared socket/session behavior belongs in `public/client.js`.
- Page-specific rendering currently lives inline in each HTML file.
- `sessionStorage` is the source of persisted identity. Clearing session intentionally returns the user to `/`.
- Chat is blocked by the server during `description` and `voting`; descriptions are emitted as `chat-message` with type `description`.
- Voting is two-step in the UI: select a player or `none`, then submit.
- Name edits emit `update-player-name`; successful updates must also refresh local session storage for the current player.

## Backend Notes

- Keep `GameManager` independent of Socket.io. It should return `{ game, event, winner? }` or `{ error }`; `server.js` handles emissions.
- Preserve server-side validation for host-only start, phase checks, turn checks, duplicate votes, player existence, and name length.
- Be careful with timers: round auto-start, disconnect grace, and game deletion can affect simulations.
- If adding async state changes inside `GameManager`, make sure `updateCallback` is used when clients need an immediate push.
- Avoid logging secret role/word assignment in production paths.

## Commands

```sh
npm start          # Run server
npm test           # Unit tests, no server required
npm run simulate   # Socket.io integration simulation, server required
```

## Releases And Commits

Releases are automated through release-please. Never bump versions manually in `package.json`, `package-lock.json`, `.release-please-manifest.json`, or `CHANGELOG.md` unless explicitly working on the release PR.

Use Conventional Commits:

| Prefix | Effect | Example |
| ------ | ------ | ------- |
| `fix:` | patch release | `fix: restore creator after mobile reconnect` |
| `feat:` | minor release | `feat: add spectator mode` |
| `feat!:` or `BREAKING CHANGE:` | major release | `feat!: redesign game API` |
| `test:` | no release section by default | `test: add mobile suspend simulation` |
| `docs:` | hidden from changelog config | `docs: expand agent testing guide` |
| `chore:` | hidden from changelog config | `chore: update dependencies` |

CI requires the `test` job to pass for PRs to `main`. The release workflow runs on pushes to `main` and opens or updates the release-please PR.

## Deployment

The app is deployed with Coolify on a VPS using nixpacks, without a Dockerfile. It is designed for Cloudflare-proxied environments, so keep WebSocket-only transport in mind when debugging production connection issues.
