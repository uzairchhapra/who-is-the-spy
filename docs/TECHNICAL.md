# Technical Implementation Guide

This document provides a detailed technical overview of the "Who's the Spy" game architecture, covering the server-side game logic, client-server communication, and state management.

## 📁 Project Structure

```
imposter-word/
├── src/
│   ├── server.js       # Express + Socket.io server entry point
│   ├── game-manager.js # Core game logic and state management
│   └── word-pairs.js   # Word pair database for game rounds
├── public/
│   ├── index.html      # Landing page (Create/Join game)
│   ├── lobby.html      # Lobby waiting room
│   ├── game.html       # Main game interface
│   ├── client.js       # Shared client utilities and session management
│   └── styles.css      # Design system and component styles
└── package.json        # Dependencies and scripts
```

---

## 🎮 Game State Machine

The game follows a strict state machine with the following phases:

```
┌─────────┐     ┌─────────────┐     ┌────────┐     ┌─────────┐     ┌───────┐
│  LOBBY  │ ──▶ │ DESCRIPTION │ ──▶ │ VOTING │ ──▶ │ RESULTS │ ──▶ │ ENDED │
└─────────┘     └─────────────┘     └────────┘     └─────────┘     └───────┘
     │                 ▲                                │
     │                 └────────────────────────────────┘
     │                        (Next Round if no winner)
     ▼
┌─────────┐
│ WAITING │ (Spectators who joined mid-game)
└─────────┘
```

### Phase Descriptions

| Phase | Description |
|-------|-------------|
| `lobby` | Players join and wait for host to start |
| `description` | Turn-based word description phase |
| `voting` | All players vote simultaneously |
| `results` | Shows elimination result, transitions to next round or end |
| `ended` | Game over, winner declared |

---

## 🔌 Socket.io Events

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `create-game` | `{ creatorName }` | Host creates a new game lobby |
| `join-game` | `{ gameCode, playerName, previousPlayerId? }` | Join or reconnect to a game |
| `start-game` | `{ gameCode }` | Host starts the game (min 3 players) |
| `submit-description` | `{ gameCode, description }` | Submit word description on your turn |
| `submit-vote` | `{ gameCode, votedPlayerId }` | Cast vote for suspected imposter |
| `send-chat` | `{ gameCode, message }` | Send chat message (disabled during gameplay) |
| `start-new-game` | `{ gameCode }` | Start a new game with same players |
| `disconnect` | — | Socket disconnection (auto-handled) |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `game-created` | `{ gameCode, playerId, game }` | Confirms game creation |
| `game-joined` | `{ playerId, game }` | Confirms successful join |
| `game-started` | `game` | Game has started, roles assigned |
| `game-state-update` | `game` | Full game state sync |
| `chat-message` | `{ sender, message, timestamp, type }` | New chat message |
| `error` | `{ message }` | Error notification |

---

## 📊 Data Structures

### Game Object

```javascript
{
  gameCode: "ABC123",           // 6-char alphanumeric code
  creatorId: "p1abc123",        // Host player ID
  status: "playing",            // lobby | playing | ended
  currentRound: 2,              // 1-indexed round number
  maxRounds: 5,                 // Maximum rounds before imposter wins
  gamePhase: "voting",          // Current phase
  
  players: [Player],            // Array of player objects
  turnOrder: ["id1", "id2"],    // Shuffled player IDs for description order
  currentTurnIndex: 3,          // Index into turnOrder (-1 during voting)
  
  votes: { "voterId": "candidateId" },  // Vote mapping
  wordPair: { civilian: "Apple", imposter: "Orange" },
  imposterId: "p2xyz789",       // For win condition checks
  
  chatHistory: [ChatMessage],   // Game log
  lastRoundResult: RoundResult  // For results UI
}
```

### Player Object

```javascript
{
  id: "abc123xyz",              // Unique player ID
  name: "PlayerName",           // Display name
  role: "civilian",             // civilian | imposter | null (pre-game)
  word: "Apple",                // Assigned word
  status: "active",             // active | disconnected | eliminated | waiting
  points: 125,                  // Cumulative score
  hasDescribed: true,           // Has submitted description this round
  hasVoted: false,              // Has voted this round
  isCreator: false              // Is game host
}
```

### Player Status Flow

```
LOBBY:     active ──▶ disconnected ──▶ (removed after 60s)
                           │
                           ▼
                      reconnected ──▶ active

IN-GAME:   active ──▶ disconnected ──▶ (60s grace period)
                           │                    │
                           ▼                    ▼
                      reconnected          eliminated (if imposter leaves)
                           │                    
                           ▼                    
                        active              
```

---

## 🎯 Core Game Logic

### Role Assignment (Round 1 Only)

```javascript
// In startRound() when currentRound === 1
const pair = getRandomPair();  // Pick random word pair
const imposterIndex = Math.floor(Math.random() * players.length);

players.forEach((p, i) => {
  if (i === imposterIndex) {
    p.role = 'imposter';
    p.word = pair.imposter;  // Similar but different word
  } else {
    p.role = 'civilian';
    p.word = pair.civilian;  // Same word for all civilians
  }
});
```

### Turn Advancement

```javascript
advanceTurn(game) {
  game.currentTurnIndex++;
  
  // Skip eliminated/disconnected players
  while (game.currentTurnIndex < game.turnOrder.length) {
    const player = findPlayer(game.turnOrder[game.currentTurnIndex]);
    if (player && player.status === 'active') {
      return { phase: 'description' };
    }
    game.currentTurnIndex++;
  }
  
  // All players described → move to voting
  game.gamePhase = 'voting';
  game.currentTurnIndex = -1;
}
```

### Vote Processing

```javascript
processVotingResults(game) {
  // Count votes
  const voteCounts = {};
  Object.values(game.votes).forEach(id => 
    voteCounts[id] = (voteCounts[id] || 0) + 1
  );
  
  // Find max votes (handle ties)
  const maxVotes = Math.max(...Object.values(voteCounts));
  const candidates = Object.entries(voteCounts)
    .filter(([_, count]) => count === maxVotes)
    .map(([id, _]) => id);
  
  // Eliminate if no tie
  if (candidates.length === 1) {
    const eliminated = findPlayer(candidates[0]);
    eliminated.status = 'eliminated';
    
    if (eliminated.role === 'imposter') {
      return { winner: 'civilians' };
    }
  }
  
  // Check if imposter wins (too few civilians)
  const activeCivilians = game.players.filter(
    p => p.role === 'civilian' && p.status === 'active'
  );
  
  if (activeCivilians.length <= 1) {
    return { winner: 'imposter' };
  }
  
  // Continue to next round
  return { winner: null };
}
```

---

## 🔄 Reconnection Handling

The game uses a multi-layer reconnection strategy:

### 1. Session Persistence (Client)
```javascript
// client.js - sessionStorage stores game session
{ gameCode, playerId, playerName }
```

### 2. Grace Period (Server)
```javascript
// On disconnect: mark as 'disconnected', start 60s timer
player.status = 'disconnected';

setTimeout(() => {
  if (player.status === 'disconnected') {
    // Handle based on game state
    if (game.status === 'lobby') {
      removePlayer(player);
    } else {
      checkWinConditions(player);
    }
  }
}, 60000);
```

### 3. Auto-Reconnect on Action
```javascript
// In submitVote/submitDescription
if (player.status === 'disconnected') {
  player.status = 'active';  // Auto-restore
}
```

---

## 🏆 Win Conditions

| Condition | Winner | Trigger |
|-----------|--------|---------|
| Imposter eliminated by vote | Civilians | Vote count = 1 player with most votes, role = imposter |
| Only 1 civilian remains | Imposter | After elimination, count(active civilians) ≤ 1 |
| Imposter disconnects | Civilians | Imposter marked disconnected for 60s |
| All civilians disconnect | Imposter | No active civilians remaining |

---

## 📱 Client State Management

The client maintains minimal local state, deriving everything from server pushes:

```javascript
let gameState = null;      // Full game object from server
let myId = session.playerId;  // From sessionStorage
let selectedVoteId = null;    // UI state only

// On any game-state-update:
socket.on('game-state-update', (game) => {
  if (game.gamePhase !== gameState?.gamePhase) {
    selectedVoteId = null;  // Reset UI on phase change
  }
  gameState = game;
  renderUI(game);  // Full re-render
});
```

---

## 🎨 UI Architecture

The game uses a **phase-based rendering** approach:

```javascript
function renderUI(game) {
  // Update common elements
  phaseIndicator.textContent = game.gamePhase;
  roundCounter.textContent = game.currentRound;
  
  // Phase-specific rendering
  switch(game.gamePhase) {
    case 'description': renderDescriptionUI(game); break;
    case 'voting': renderVotingUI(game); break;
    case 'results': renderResultsUI(game); break;
  }
  
  // Always update
  renderStatusBar(game);
  updateInputState(game);
}
```

---

## 🔒 Security Considerations

1. **Player ID Validation**: All actions validate playerId against the session
2. **Phase Enforcement**: Actions only allowed during correct phase
3. **Turn Enforcement**: Descriptions only accepted from current turn player
4. **No Imposter Leaks**: Server never logs role assignments to console

---

## 📈 Scaling Considerations

Current architecture (single Node.js process) supports:
- ~100 concurrent games
- ~500 concurrent players

For production scaling:
- Add Redis for game state (multi-instance)
- Use Socket.io Redis adapter for cross-instance events
- Implement game TTL and cleanup

---

## 🧪 Testing

Manual testing scenarios:
1. **Happy Path**: Create → Join → Start → Describe → Vote → Win/Lose
2. **Reconnection**: Refresh page mid-game, verify state restored
3. **Edge Cases**: 
   - Tie votes (no elimination)
   - Imposter disconnects
   - Last civilian eliminated
4. **Stress**: 6+ players, rapid actions

---

*For gameplay rules, see [README.md](../README.md)*
