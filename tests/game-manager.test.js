'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const GameManager = require('../src/game-manager');

// Creates a GM and populates n players (Alice + Bob, Carol, Dave, Eve...)
function setup(n = 3) {
    const gm = new GameManager(() => {});
    const { gameCode, playerId: creatorId } = gm.createGame('s0', 'Alice');
    const playerIds = [creatorId];
    const names = ['Bob', 'Carol', 'Dave', 'Eve', 'Frank'];
    for (let i = 1; i < n; i++) {
        const { playerId } = gm.joinGame(gameCode, `s${i}`, names[i - 1]);
        playerIds.push(playerId);
    }
    return { gm, gameCode, creatorId, playerIds };
}

// Advances a game through the entire description phase
function completeDescriptions(gm, gameCode, game) {
    for (const playerId of [...game.turnOrder]) {
        ({ game } = gm.submitDescription(gameCode, playerId, 'test'));
    }
    return game;
}

describe('createGame', () => {
    it('creates game with correct initial state', () => {
        const gm = new GameManager(() => {});
        const { gameCode, game } = gm.createGame('s1', 'Alice');
        assert.equal(game.status, 'lobby');
        assert.equal(game.gamePhase, 'lobby');
        assert.equal(game.players.length, 1);
        assert.equal(game.players[0].name, 'Alice');
        assert.equal(game.players[0].isCreator, true);
        assert.equal(gameCode.length, 6);
    });
});

describe('joinGame', () => {
    it('adds a new player successfully', () => {
        const { gm, gameCode } = setup(1);
        const result = gm.joinGame(gameCode, 's99', 'Bob');
        assert.ok(!result.error);
        assert.equal(result.game.players.length, 2);
    });

    it('returns error for invalid game code', () => {
        const gm = new GameManager(() => {});
        const result = gm.joinGame('BADCOD', 's1', 'Alice');
        assert.ok(result.error);
    });

    it('deduplicates names with suffix', () => {
        const { gm, gameCode } = setup(1);
        gm.joinGame(gameCode, 's2', 'Alice'); // duplicate of creator
        const { players } = gm.games.get(gameCode);
        assert.ok(players.some(p => p.name === 'Alice (1)'));
    });

    it('reconnects a disconnected player', () => {
        const { gm, gameCode, playerIds } = setup(2);
        const game = gm.games.get(gameCode);
        game.players[0].status = 'disconnected';

        const result = gm.joinGame(gameCode, 'new-socket', 'Alice', playerIds[0]);
        assert.ok(!result.error);
        assert.equal(result.playerId, playerIds[0]);
        assert.equal(game.players[0].status, 'active');
    });

    it('player joining mid-game gets waiting status', () => {
        const { gm, gameCode, creatorId } = setup(3);
        gm.startGame(gameCode, creatorId);
        const result = gm.joinGame(gameCode, 'late-s', 'Latecomer');
        assert.ok(!result.error);
        const newPlayer = result.game.players.find(p => p.name === 'Latecomer');
        assert.equal(newPlayer.status, 'waiting');
    });
});

describe('startGame', () => {
    it('rejects non-host', () => {
        const { gm, gameCode, playerIds } = setup(3);
        const result = gm.startGame(gameCode, playerIds[1]);
        assert.ok(result.error);
    });

    it('rejects fewer than 3 players', () => {
        const { gm, gameCode, creatorId } = setup(2);
        const result = gm.startGame(gameCode, creatorId);
        assert.ok(result.error);
    });

    it('starts with 3+ players', () => {
        const { gm, gameCode, creatorId } = setup(3);
        const result = gm.startGame(gameCode, creatorId);
        assert.ok(!result.error);
        assert.equal(result.game.status, 'playing');
        assert.equal(result.game.currentRound, 1);
    });
});

describe('role assignment', () => {
    it('assigns exactly one imposter', () => {
        const { gm, gameCode, creatorId } = setup(4);
        const { game } = gm.startGame(gameCode, creatorId);
        assert.equal(game.players.filter(p => p.role === 'imposter').length, 1);
        assert.equal(game.players.filter(p => p.role === 'civilian').length, 3);
    });

    it('all civilians share the same word', () => {
        const { gm, gameCode, creatorId } = setup(4);
        const { game } = gm.startGame(gameCode, creatorId);
        const civilianWords = game.players.filter(p => p.role === 'civilian').map(p => p.word);
        assert.ok(civilianWords.every(w => w === civilianWords[0]));
    });

    it('imposter gets a different word than civilians', () => {
        const { gm, gameCode, creatorId } = setup(4);
        const { game } = gm.startGame(gameCode, creatorId);
        const imposter = game.players.find(p => p.role === 'imposter');
        const civilian = game.players.find(p => p.role === 'civilian');
        assert.notEqual(imposter.word, civilian.word);
    });
});

describe('description phase', () => {
    it('rejects description out of turn', () => {
        const { gm, gameCode, creatorId, playerIds } = setup(3);
        const { game } = gm.startGame(gameCode, creatorId);
        const notMyTurn = playerIds.find(id => id !== game.turnOrder[game.currentTurnIndex]);
        const result = gm.submitDescription(gameCode, notMyTurn, 'something');
        assert.ok(result.error);
    });

    it('accepts description from current turn player', () => {
        const { gm, gameCode, creatorId } = setup(3);
        const { game } = gm.startGame(gameCode, creatorId);
        const currentId = game.turnOrder[game.currentTurnIndex];
        const result = gm.submitDescription(gameCode, currentId, 'fluffy');
        assert.ok(!result.error);
    });

    it('all descriptions complete → voting phase', () => {
        const { gm, gameCode, creatorId } = setup(3);
        let { game } = gm.startGame(gameCode, creatorId);
        game = completeDescriptions(gm, gameCode, game);
        assert.equal(game.gamePhase, 'voting');
    });
});

describe('voting phase', () => {
    function getToVoting(n = 3) {
        const { gm, gameCode, creatorId } = setup(n);
        let { game } = gm.startGame(gameCode, creatorId);
        game = completeDescriptions(gm, gameCode, game);
        return { gm, gameCode, game };
    }

    it('rejects duplicate vote', () => {
        const { gm, gameCode, game } = getToVoting();
        const [p0, p1, p2] = game.players;
        gm.submitVote(gameCode, p0.id, p1.id);
        const result = gm.submitVote(gameCode, p0.id, p2.id);
        assert.ok(result.error);
    });

    it('civilians win when imposter is voted out unanimously', () => {
        const { gm, gameCode, game } = getToVoting();
        const imposter = game.players.find(p => p.role === 'imposter');
        let result;
        for (const p of game.players) {
            result = gm.submitVote(gameCode, p.id, imposter.id);
        }
        assert.equal(result.winner, 'civilians');
        assert.equal(result.game.status, 'ended');
    });

    it('tie vote eliminates no one', () => {
        // 4 players: 2 vote for p0, 2 vote for p1 → tie
        const { gm, gameCode, game } = getToVoting(4);
        const [p0, p1, p2, p3] = game.players;
        gm.submitVote(gameCode, p0.id, p1.id);
        gm.submitVote(gameCode, p1.id, p0.id);
        gm.submitVote(gameCode, p2.id, p1.id);
        const result = gm.submitVote(gameCode, p3.id, p0.id);
        assert.equal(result.winner, null);
        assert.ok(game.players.every(p => p.status !== 'eliminated'));
    });

    it('imposter wins when only 1 civilian remains after elimination', () => {
        // 3 players: 1 imposter, 2 civilians → vote out a civilian → imposter wins
        const { gm, gameCode, game } = getToVoting(3);
        const civilian = game.players.find(p => p.role === 'civilian');
        let result;
        for (const p of game.players) {
            result = gm.submitVote(gameCode, p.id, civilian.id);
        }
        assert.equal(result.winner, 'imposter');
    });
});

describe('startNewGame', () => {
    it('resets roles and starts a fresh round', () => {
        const { gm, gameCode, creatorId } = setup(3);
        let { game } = gm.startGame(gameCode, creatorId);
        game = completeDescriptions(gm, gameCode, game);
        const imposter = game.players.find(p => p.role === 'imposter');
        for (const p of game.players) gm.submitVote(gameCode, p.id, imposter.id);

        const result = gm.startNewGame(gameCode, creatorId);
        assert.ok(!result.error);
        assert.equal(result.game.currentRound, 1);
        assert.ok(result.game.players.every(p => p.role !== null));
    });
});
