# Who's the Spy

A real-time multiplayer social deduction game built with **Node.js**, **Socket.io**, and vanilla CSS/JS. Players describe their secret words in turns, then vote to find the imposter among them.

## How to Play

1. **Create or join a lobby** using a 6-character game code.
2. **Roles are assigned**: civilians all get the same word; the imposter gets a similar but different word.
3. **Describe**: each player gives a one-word clue — vague enough not to expose yourself, specific enough to signal you know the word.
4. **Vote**: everyone votes on who they think is the imposter.
5. **Win conditions**:
   - Civilians win by eliminating the imposter.
   - Imposter wins by surviving until only 2 civilians remain.

## Tech Stack

- **Backend**: Node.js, Express
- **Real-time**: Socket.io (WebSocket-only)
- **Frontend**: HTML5, Vanilla JS, CSS3

## Local Development

Requires Node.js 24 via nvm:

```bash
nvm use 24
npm install
npm start
```

Open `http://localhost:3000`.

## Deployment

Deployed via [Coolify](https://coolify.io) on a VPS using nixpacks. Designed for Cloudflare-proxied environments.

## Documentation

- [Technical Implementation Guide](docs/TECHNICAL.md)
