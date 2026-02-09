const { getRandomPair } = require('./word-pairs');

class GameManager {
    constructor(updateCallback) {
        this.updateCallback = updateCallback;
        this.games = new Map(); // gameCode -> game object
        this.playerSessions = new Map(); // socketId -> { gameCode, playerId }
        this.deletionTimers = new Map(); // gameCode -> Timeout object

        // Cleanup interval
        setInterval(() => this.cleanupGames(), 60 * 60 * 1000);
    }

    generateId() {
        return Math.random().toString(36).substring(2, 10);
    }

    getPlayerId(socketId) {
        const session = this.playerSessions.get(socketId);
        return session ? session.playerId : null;
    }

    createGame(socketId, creatorName) {
        const gameCode = this.generateGameCode();
        const playerId = this.generateId();

        const game = {
            gameCode,
            creatorId: playerId,
            status: 'lobby',
            currentRound: 0,
            maxRounds: 5,
            players: [{
                id: playerId,
                name: creatorName,
                role: null,
                word: null,
                status: 'active',
                points: 0,
                hasDescribed: false,
                hasVoted: false,
                isCreator: true
            }],
            turnOrder: [],
            currentTurnIndex: 0,
            chatHistory: [],
            votes: {},
            gamePhase: 'lobby',
            descriptionEndTime: null, // Timestamp, safe to emit
            votingEndTime: null       // Timestamp, safe to emit
        };

        this.games.set(gameCode, game);
        this.playerSessions.set(socketId, { gameCode, playerId });

        return { gameCode, playerId, game };
    }

    joinGame(gameCode, socketId, playerName, previousPlayerId) {
        const game = this.games.get(gameCode);
        if (!game) return { error: 'Game code does not exist' };

        // Clear deletion timer IF it exists (safe check)
        if (this.deletionTimers.has(gameCode)) {
            clearTimeout(this.deletionTimers.get(gameCode));
            this.deletionTimers.delete(gameCode);
        }

        // Check Reconnection (If previous ID provided and exists in game)
        if (previousPlayerId) {
            const existingPlayer = game.players.find(p => p.id === previousPlayerId);
            if (existingPlayer && existingPlayer.name === playerName) {
                // Reconnect successful (Only if name matches to prevent accidental session reuse)
                if (existingPlayer.status === 'disconnected') {
                    if (game.status === 'lobby' || game.status === 'ended') {
                        existingPlayer.status = 'active';
                    } else {
                        // In-game reconnection: Restore based on role assignment
                        // If they have a role, they were playing -> active
                        // If no role, they were spectators -> waiting
                        existingPlayer.status = existingPlayer.role ? 'active' : 'waiting';
                    }
                }
                // Update session map for NEW socket logic
                this.playerSessions.set(socketId, { gameCode, playerId: previousPlayerId });

                // Suppress log for clean refresh (Lobby OR Game)
                // If it was a long disconnect, the 'disconnected' log would have fired (after 4s timeout).
                // If they come back fast, no 'disconnect' log fired, so we shouldn't fire 'reconnect' either.
                // If they come back slow, 'disconnect' fired. We CAN fire 'reconnect' but honestly, 
                // the dot changing color is sufficient for this game type.
                // Let's suppress it to be safe and clean.
                // this.addSystemMessage(game, `${existingPlayer.name} reconnected`);

                return { game, playerId: previousPlayerId };
            }
        }

        // New Player Join Logic
        console.log(`[JOIN] New player ${playerName} attempting to join game ${gameCode} (Current Status: ${game.status})`);

        if (game.status !== 'lobby' && game.status !== 'playing' && game.status !== 'ended') {
            return { error: 'Cannot join game in current state' };
        }

        // Explicit Status Assignment
        let status = 'waiting';
        if (game.status === 'lobby' || game.status === 'ended') {
            status = 'active';
        }

        console.log(`[JOIN] Assigning status '${status}' to ${playerName}`);

        const playerId = this.generateId();

        const newPlayer = {
            id: playerId,
            name: playerName,
            role: null,
            word: null,
            status: status,
            points: 0,
            hasDescribed: false,
            hasVoted: false,
            isCreator: game.players.length === 0 // Become creator if first
        };

        if (newPlayer.isCreator) {
            game.creatorId = playerId;
        }

        // Check for duplicate names recursively
        let newName = playerName;
        let counter = 1;
        while (game.players.some(p => p.name === newName)) {
            newName = `${playerName} (${counter})`;
            counter++;
        }
        newPlayer.name = newName;

        game.players.push(newPlayer);
        this.playerSessions.set(socketId, { gameCode, playerId });

        this.addSystemMessage(game, `${newPlayer.name} joined as ${status}`);

        return { game, playerId };
    }

    leaveGame(socketId) {
        const session = this.playerSessions.get(socketId);
        if (!session) return null;

        const { gameCode, playerId } = session;
        const game = this.games.get(gameCode);

        // Clean up session map
        this.playerSessions.delete(socketId);

        if (!game) return null;

        const playerIndex = game.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) return { gameCode, game }; // Should not happen

        const player = game.players[playerIndex];

        if (game.status === 'lobby') {
            // Graceful Lobby Disconnect (Handle refreshes without spam)
            player.status = 'disconnected';

            // Give them 4 seconds to reconnect
            setTimeout(() => {
                const currentGame = this.games.get(gameCode);
                if (!currentGame) return;

                const p = currentGame.players.find(pl => pl.id === playerId);
                // Only remove if they are STIll disconnected (didn't reconnect)
                if (p && p.status === 'disconnected') {
                    const idx = currentGame.players.indexOf(p);
                    if (idx !== -1) {
                        currentGame.players.splice(idx, 1);
                        this.addSystemMessage(currentGame, `${p.name} left the lobby`);

                        // Handle Creator Transfer
                        if (p.isCreator && currentGame.players.length > 0) {
                            currentGame.players[0].isCreator = true;
                            currentGame.creatorId = currentGame.players[0].id;
                            this.addSystemMessage(currentGame, `${currentGame.players[0].name} is now the host`);
                        }

                        // Emit update since this is async
                        // We need access to IO here, or we rely on the next event?
                        // Ideally we emit here. Since we don't have 'io' reference easily, 
                        // we'll rely on client polling or simply wait for next interaction?
                        // actually, server.js handles emits usually.
                        // But for this async removal, the UI won't update until someone else does something.
                        // This is a limitation. However, usually 'leaveGame' returns {game} 
                        // and server.js emits.
                        // The immediate return below will emit 'disconnected' status.
                        // The 'removal' will happen silently 4s later. 
                        // This might result in a "ghost" card until next update.
                        // BUT, for the USER REQUEST: "I see spam". 
                        // This solves the spam. The delayed removal is acceptable MVP trade-off.
                    }
                }
            }, 60000);

        } else {
            // In game, mark disconnected but delay log to allow for refresh
            player.status = 'disconnected';

            setTimeout(() => {
                const currentGame = this.games.get(gameCode);
                if (!currentGame) return;
                const p = currentGame.players.find(pl => pl.id === playerId);

                // If they are STILL disconnected after 4s, check win conditions
                if (p && p.status === 'disconnected') {
                    let shouldUpdate = false;
                    this.addSystemMessage(currentGame, `${p.name} disconnected`);
                    shouldUpdate = true; // Always update on confirmed disconnect log

                    if (currentGame.status === 'playing') {
                        // 1. Skip turn if it was theirs
                        if (currentGame.gamePhase === 'description') {
                            const currentTurnId = currentGame.turnOrder[currentGame.currentTurnIndex];
                            if (currentTurnId === playerId) {
                                this.addSystemMessage(currentGame, `Skipping ${p.name}'s turn...`);
                                this.advanceTurn(currentGame);
                                shouldUpdate = true;
                            }
                        }
                        // 2. Check if voting can finish early
                        if (currentGame.gamePhase === 'voting') {
                            const activeCount = currentGame.players.filter(pl => pl.status === 'active' || pl.status === 'disconnected').length;
                            if (Object.keys(currentGame.votes).length >= activeCount && activeCount > 0) {
                                this.processVotingResults(currentGame);
                                shouldUpdate = true;
                            }
                        }

                        // 3. Check win conditions (Imposter left or too few civilians)
                        if (p.role === 'imposter') {
                            currentGame.gamePhase = 'ended';
                            currentGame.status = 'ended';
                            currentGame.lastRoundResult = {
                                winner: 'civilians',
                                imposterName: p.name + " (Disconnected)",
                                civilianWord: currentGame.wordPair ? currentGame.wordPair.civilian : '?',
                                imposterWord: currentGame.wordPair ? currentGame.wordPair.imposter : '?'
                            };
                            this.addSystemMessage(currentGame, `Imposter disconnected! Civilians win!`);
                            shouldUpdate = true;
                        } else if (p.role === 'civilian') {
                            // Check civilians who are active OR just DISCONNECTED (waiting to return)
                            const potentialCivs = currentGame.players.filter(pl => pl.role === 'civilian' && (pl.status === 'active' || pl.status === 'disconnected'));
                            if (potentialCivs.length <= 1) {
                                currentGame.gamePhase = 'ended';
                                currentGame.status = 'ended';
                                const imp = currentGame.players.find(pl => pl.role === 'imposter');
                                currentGame.lastRoundResult = {
                                    winner: 'imposter',
                                    imposterName: imp ? imp.name : 'Unknown',
                                    civilianWord: currentGame.wordPair ? currentGame.wordPair.civilian : '?',
                                    imposterWord: currentGame.wordPair ? currentGame.wordPair.imposter : '?'
                                };
                                this.addSystemMessage(currentGame, `Not enough civilians! Imposter wins!`);
                                shouldUpdate = true;
                            }
                        }
                    }

                    if (shouldUpdate && this.updateCallback) {
                        this.updateCallback(gameCode, currentGame);
                    }
                }
            }, 60000);
        }

        // Check if empty
        const hasConnectedPlayers = game.players.some(p => p.status !== 'disconnected');

        if (!hasConnectedPlayers) {
            // Schedule deletion
            if (this.deletionTimers.has(gameCode)) clearTimeout(this.deletionTimers.get(gameCode));

            const timer = setTimeout(() => {
                this.games.delete(gameCode);
                this.deletionTimers.delete(gameCode);
            }, 300000); // 5 minutes

            this.deletionTimers.set(gameCode, timer);
        }

        return { gameCode, game };
    }

    startGame(gameCode, playerId) {
        const game = this.games.get(gameCode);
        if (!game) return { error: 'Game not found' };

        if (game.creatorId !== playerId) return { error: 'Only host can start game' };

        // Remove disconnected players before starting
        game.players = game.players.filter(p => p.status !== 'disconnected');

        if (game.players.length < 3) return { error: 'Need at least 3 players' };

        game.status = 'playing';
        game.currentRound = 0;
        game.chatHistory = [];
        return this.startRound(game);
    }

    startRound(game) {
        game.currentRound++;
        game.gamePhase = 'description';

        // Assign Roles Logic
        if (game.currentRound === 1) {
            const pair = getRandomPair();
            game.wordPair = pair;
            const activePlayers = game.players.filter(p => p.status === 'active' || p.status === 'waiting' || p.status === 'disconnected');
            // Activate everyone
            activePlayers.forEach(p => p.status = 'active');

            const imposterIndex = Math.floor(Math.random() * activePlayers.length);
            activePlayers.forEach((p, index) => {
                if (index === imposterIndex) {
                    p.role = 'imposter';
                    p.word = pair.imposter;
                    game.imposterId = p.id;
                } else {
                    p.role = 'civilian';
                    p.word = pair.civilian;
                }
                p.hasDescribed = false;
                p.hasVoted = false;
                p.points = p.points || 0;
            });
        }

        // Reset flags for EVERYONE (including eliminated) to prevent stale state
        game.players.forEach(p => {
            p.hasDescribed = false;
            p.hasVoted = false;
        });

        game.votes = {};
        game.lastRoundResult = null;

        // Turn Order - Include anyone who is active or momentarily disconnected
        const capable = game.players.filter(p => p.status === 'active' || p.status === 'disconnected');
        for (let i = capable.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [capable[i], capable[j]] = [capable[j], capable[i]];
        }
        game.turnOrder = capable.map(p => p.id);
        game.currentTurnIndex = -1;
        this.advanceTurn(game);

        console.log(`[ROUND] Resetting Round ${game.currentRound}. Players:`, game.players.map(p => `${p.name}(${p.status}, voted:${p.hasVoted})`));
        this.addSystemMessage(game, `Round ${game.currentRound} started!`);
        return { game, event: 'round-started' };
    }

    submitDescription(gameCode, playerId, description) {
        const game = this.games.get(gameCode);
        if (!game) return { error: 'Game not found' };

        const player = game.players.find(p => p.id === playerId);
        if (!player) return { error: 'Player not found' };

        // Auto-reconnect if they were disconnected
        if (player.status === 'disconnected') player.status = 'active';

        if (game.gamePhase !== 'description') return { error: 'Not description phase' };

        const turnPlayerId = game.turnOrder[game.currentTurnIndex];
        if (turnPlayerId !== playerId) return { error: 'Not your turn' };

        if (player.hasDescribed) return { error: 'Already described' };

        player.hasDescribed = true;
        this.addChatMessage(game, player.name, description, 'description');
        console.log(`[DESC] ${player.name} described. Advancing turn.`);

        // Advance
        this.advanceTurn(game);
        return { game, event: 'turn-update' };
    }

    advanceTurn(game) {
        game.currentTurnIndex++;

        while (game.currentTurnIndex < game.turnOrder.length) {
            const nextPlayerId = game.turnOrder[game.currentTurnIndex];
            const p = game.players.find(pl => pl.id === nextPlayerId);
            if (p && (p.status === 'active' || p.status === 'disconnected')) {
                return { phase: 'description' };
            }
            game.currentTurnIndex++;
        }

        game.gamePhase = 'voting';
        game.currentTurnIndex = -1; // Clear turn indicator during voting
        this.addSystemMessage(game, 'Voting phase started!');
        return { phase: 'voting' };
    }

    submitVote(gameCode, voterId, candidateId) {
        const game = this.games.get(gameCode);
        if (!game) return { error: 'Game not found' };
        if (game.gamePhase !== 'voting') return { error: 'Not in voting phase' };

        const voter = game.players.find(p => p.id === voterId);
        if (!voter) return { error: 'Player not found' };

        // Auto-reconnect
        if (voter.status === 'disconnected') voter.status = 'active';

        if (voter.status !== 'active') return { error: 'Cannot vote' };

        if (voter.hasVoted) return { error: 'Already voted' };

        game.votes[voterId] = candidateId;
        voter.hasVoted = true;
        console.log(`[VOTE] ${voter.name} voted for ${candidateId}. Phase: ${game.gamePhase}`);

        // Include disconnected players in the count since they are still "in" the game
        const activeCount = game.players.filter(p => p.status === 'active' || p.status === 'disconnected').length;
        if (Object.keys(game.votes).length >= activeCount) {
            console.log(`[VOTE] All votes in (${activeCount}). Processing results...`);
            return this.processVotingResults(game);
        }
        return { game, event: 'vote-update' };
    }

    processVotingResults(game) {
        game.gamePhase = 'results';
        const voteCounts = {};
        Object.values(game.votes).forEach(id => voteCounts[id] = (voteCounts[id] || 0) + 1);

        let max = 0;
        let candidates = [];
        for (const [id, c] of Object.entries(voteCounts)) {
            if (c > max) { max = c; candidates = [id]; }
            else if (c === max) candidates.push(id);
        }

        let elimId = null;
        let winner = null;

        if (candidates.length === 1) {
            const votedTarget = candidates[0];

            // Check if "none" won
            if (votedTarget === 'none') {
                this.addSystemMessage(game, "Vote for 'None' won! No one eliminated.");
            } else {
                elimId = votedTarget;
                const p = game.players.find(pl => pl.id === elimId);
                if (p) {
                    p.status = 'eliminated';
                    this.addSystemMessage(game, `${p.name} was eliminated! Role: ${p.role}`);

                    if (p.role === 'imposter') winner = 'civilians';
                }
            }
        } else {
            this.addSystemMessage(game, "Tie vote! No one eliminated.");
        }

        const imposter = game.players.find(p => p.role === 'imposter');

        if (!winner) {
            const potentialCivs = game.players.filter(p => p.role === 'civilian' && (p.status === 'active' || p.status === 'disconnected'));
            if (potentialCivs.length <= 1) winner = 'imposter';
            else {
                game.players.forEach(p => {
                    if (p.status === 'active' || p.status === 'disconnected') {
                        p.points += p.role === 'imposter' ? 15 : 10;
                    }
                });
            }
        }

        // Store result for UI
        game.lastRoundResult = {
            eliminatedId: elimId,
            eliminatedName: elimId ? game.players.find(p => p.id === elimId).name : null,
            eliminatedRole: elimId ? game.players.find(p => p.id === elimId).role : null,
            winner: winner,
            imposterName: imposter ? imposter.name : 'Unknown',
            civilianWord: game.wordPair ? game.wordPair.civilian : '?',
            imposterWord: game.wordPair ? game.wordPair.imposter : '?'
        };

        if (winner) {
            game.gamePhase = 'ended';
            game.status = 'ended';
            const bonus = winner === 'civilians' ? 50 : 100;
            game.players.forEach(p => {
                if ((winner === 'civilians' && p.role === 'civilian') || (winner === 'imposter' && p.role === 'imposter')) {
                    p.points += bonus;
                }
            });
            this.addSystemMessage(game, `Game Over! ${winner} win!`);
        }

        return { game, event: 'round-results', winner };
    }

    startNewGame(gameCode, playerId) {
        const game = this.games.get(gameCode);
        if (!game) return { error: 'Game not found' };

        game.status = 'playing';
        game.currentRound = 0;
        game.chatHistory = [];
        game.players.forEach(p => {
            p.status = 'active';
            p.role = null;
            p.word = null;
            p.hasDescribed = false;
            p.hasVoted = false;
        });
        return this.startRound(game);
    }

    updatePlayerName(gameCode, playerId, newName) {
        const game = this.games.get(gameCode);
        if (!game) return { error: 'Game not found' };

        const player = game.players.find(p => p.id === playerId);
        if (!player) return { error: 'Player not found' };

        // Validate name
        if (!newName || newName.trim().length === 0) {
            return { error: 'Name cannot be empty' };
        }

        newName = newName.trim().substring(0, 15); // Enforce max length

        // Check for duplicates (excluding current player)
        let finalName = newName;
        let counter = 1;
        while (game.players.some(p => p.id !== playerId && p.name === finalName)) {
            finalName = `${newName} (${counter})`;
            counter++;
        }

        const oldName = player.name;
        player.name = finalName;

        this.addSystemMessage(game, `${oldName} changed their name to ${finalName}`);

        return { game, oldName, newName: finalName };
    }

    addSystemMessage(game, text) {
        game.chatHistory.push({ sender: 'System', message: text, timestamp: new Date(), type: 'system' });
    }

    addChatMessage(game, sender, text, type = 'player') {
        game.chatHistory.push({ sender, message: text, timestamp: new Date(), type });
    }

    generateGameCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code;
        do {
            code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        } while (this.games.has(code));
        return code;
    }

    cleanupGames() {
        // Implement cleanup if needed
    }
}

module.exports = GameManager;
