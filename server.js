const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const GameManager = require('./game-manager');
const path = require('path');
const { version } = require('./package.json');

const app = express();

// Trust proxy for production deployment (required when behind reverse proxy)
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

const gameManager = new GameManager((gameCode, game) => {
    io.to(gameCode).emit('game-state-update', game);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/lobby', (req, res) => res.sendFile(path.join(__dirname, 'public/lobby.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public/game.html')));
app.get('/health', (req, res) => res.sendStatus(200));
app.get('/version', (req, res) => res.json({ version }));

io.on('connection', (socket) => {
    // console.log('New connection:', socket.id); // Disabled log spam

    socket.on('create-game', ({ playerName }) => {
        try {
            const { gameCode, playerId, game } = gameManager.createGame(socket.id, playerName);
            socket.join(gameCode);
            socket.emit('game-created', { gameCode, playerId });
            io.to(gameCode).emit('player-update', game.players);
        } catch (e) {
            console.error(e);
            socket.emit('error', { message: 'Failed to create game' });
        }
    });

    socket.on('join-game', ({ gameCode, playerName, previousPlayerId }) => {
        const result = gameManager.joinGame(gameCode, socket.id, playerName, previousPlayerId);
        if (result.error) {
            socket.emit('error', { message: result.error });
        } else {
            socket.join(gameCode);
            socket.emit('game-joined', { gameCode, playerId: result.playerId, gameState: result.game });
            io.to(gameCode).emit('game-state-update', result.game);
        }
    });

    socket.on('start-game', ({ gameCode }) => {
        const playerId = gameManager.getPlayerId(socket.id);
        const result = gameManager.startGame(gameCode, playerId);
        if (result.error) {
            socket.emit('error', { message: result.error });
        } else {
            io.to(gameCode).emit('game-started', result.game);
        }
    });

    socket.on('submit-description', ({ gameCode, description }) => {
        const playerId = gameManager.getPlayerId(socket.id);
        const result = gameManager.submitDescription(gameCode, playerId, description);
        if (result.error) {
            socket.emit('error', { message: result.error });
        } else {
            io.to(gameCode).emit('game-state-update', result.game);

            // Emit chat message for description so all clients see it in the feed
            const player = result.game.players.find(p => p.id === playerId);
            if (player) {
                io.to(gameCode).emit('chat-message', {
                    sender: player.name,
                    message: description,
                    timestamp: new Date(),
                    type: 'description'
                });
            }
        }
    });

    socket.on('submit-vote', ({ gameCode, votedPlayerId }) => {
        const playerId = gameManager.getPlayerId(socket.id);
        const result = gameManager.submitVote(gameCode, playerId, votedPlayerId);
        if (result.error) {
            socket.emit('error', { message: result.error });
        } else {
            io.to(gameCode).emit('game-state-update', result.game);
            if (result.event === 'round-results' && !result.winner) {
                setTimeout(() => {
                    const nextResult = gameManager.startRound(result.game);
                    io.to(gameCode).emit('game-state-update', nextResult.game);
                }, 5000);
            }
        }
    });

    socket.on('send-chat', ({ gameCode, message }) => {
        const game = gameManager.games.get(gameCode);
        const playerId = gameManager.getPlayerId(socket.id);
        if (game && playerId) {
            // Restrict chat during strict phases
            if (game.gamePhase === 'description' || game.gamePhase === 'voting') {
                return; // Chat disabled
            }

            const player = game.players.find(p => p.id === playerId);
            if (player) {
                gameManager.addChatMessage(game, player.name, message);
                io.to(gameCode).emit('chat-message', { sender: player.name, message, timestamp: new Date(), type: 'player' });
            }
        }
    });

    socket.on('start-new-game', ({ gameCode }) => {
        const playerId = gameManager.getPlayerId(socket.id);
        const result = gameManager.startNewGame(gameCode, playerId);
        if (result.error) socket.emit('error', { message: result.error });
        else io.to(gameCode).emit('game-started', result.game);
    });

    socket.on('update-player-name', ({ gameCode, newName }) => {
        const playerId = gameManager.getPlayerId(socket.id);
        const result = gameManager.updatePlayerName(gameCode, playerId, newName);
        if (result.error) {
            socket.emit('error', { message: result.error });
        } else {
            io.to(gameCode).emit('game-state-update', result.game);
            io.to(gameCode).emit('player-name-updated', {
                playerId,
                oldName: result.oldName,
                newName: result.newName
            });
        }
    });

    socket.on('disconnect', () => {
        const result = gameManager.leaveGame(socket.id);
        if (result && result.game) {
            io.to(result.gameCode).emit('game-state-update', result.game);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
