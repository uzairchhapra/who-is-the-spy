'use strict';

/**
 * Socket.io integration simulation — replaces opening tabs manually.
 *
 * Usage:
 *   npm run simulate                          # all scenarios
 *   SCENARIO=happy-path npm run simulate
 *   SCENARIO=imposter-wins npm run simulate
 *   SCENARIO=tie-vote npm run simulate        # waits ~5s for round 2
 *   SCENARIO=reconnect npm run simulate
 *   SERVER_URL=https://your-vps npm run simulate
 */

const { io } = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SCENARIO   = process.env.SCENARIO   || 'all';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Assertion
// ---------------------------------------------------------------------------

function assert(condition, message) {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Resolves on the next occurrence of `event` on `socket`. */
function waitForEvent(socket, event, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for "${event}"`)),
            timeout
        );
        socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
    });
}

/**
 * Resolves with the next game state that satisfies `predicate`.
 * MUST be called before emitting the action that will trigger the update,
 * otherwise a fast server response can be missed.
 */
function waitForGameState(socket, predicate, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('waitForGameState timeout')),
            timeout
        );
        const onUpdate = (game) => {
            if (predicate(game)) {
                clearTimeout(timer);
                socket.off('game-state-update', onUpdate);
                resolve(game);
            }
        };
        socket.on('game-state-update', onUpdate);
    });
}

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

async function createClient(name) {
    const socket = io(SERVER_URL, { transports: ['websocket'] });
    await waitForEvent(socket, 'connect');
    const player = { name, socket, playerId: null, gameCode: null, gameState: null };
    socket.on('game-state-update', (g) => { player.gameState = g; });
    socket.on('error', (err) => console.log(`  [${name}] server error: ${err.message}`));
    return player;
}

async function createClients(names) {
    return Promise.all(names.map(createClient));
}

async function setupGame(players) {
    const [host, ...guests] = players;

    host.socket.emit('create-game', { playerName: host.name });
    const { gameCode, playerId } = await waitForEvent(host.socket, 'game-created');
    host.playerId = playerId;
    host.gameCode = gameCode;

    for (const p of guests) {
        p.socket.emit('join-game', { gameCode, playerName: p.name });
        const joined = await waitForEvent(p.socket, 'game-joined');
        p.playerId  = joined.playerId;
        p.gameCode  = gameCode;
    }

    return gameCode;
}

async function startGame(players, gameCode) {
    const host = players[0];
    // Listen before emitting to avoid missing the event
    const started = waitForEvent(host.socket, 'game-started');
    host.socket.emit('start-game', { gameCode });
    return started;
}

/** Drives the description phase in turn order. Resolves when voting begins. */
async function runDescriptions(players, gameCode, game) {
    // Set up listener BEFORE emitting so we never miss the transition
    const votingReady = waitForGameState(
        players[0].socket,
        (g) => g.gamePhase === 'voting'
    );

    for (const playerId of [...game.turnOrder]) {
        const p = players.find((s) => s.playerId === playerId);
        if (!p) continue;
        p.socket.emit('submit-description', { gameCode, description: 'test clue' });
        await delay(150);
    }

    return votingReady;
}

/** All active players vote for `targetId`. Resolves when results/ended phase. */
async function runVotes(players, gameCode, game, targetId) {
    const resultsReady = waitForGameState(
        players[0].socket,
        (g) => g.gamePhase === 'results' || g.gamePhase === 'ended',
        6000
    );

    const active = game.players.filter((p) => p.status === 'active');
    for (const gp of active) {
        const sp = players.find((p) => p.playerId === gp.id);
        if (!sp) continue;
        sp.socket.emit('submit-vote', { gameCode, votedPlayerId: targetId });
        await delay(100);
    }

    return resultsReady;
}

function disconnectAll(players) {
    players.forEach((p) => { if (p.socket.connected) p.socket.disconnect(); });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function happyPath() {
    console.log('\n[happy-path] Civilians unanimously identify and eliminate the imposter');
    const players  = await createClients(['Alice', 'Bob', 'Carol', 'Dave']);
    const gameCode = await setupGame(players);
    let game       = await startGame(players, gameCode);

    const imposter = game.players.find((p) => p.role === 'imposter');
    console.log(`  word pair: "${game.wordPair.civilian}" / "${game.wordPair.imposter}" | imposter: ${imposter.name}`);

    game = await runDescriptions(players, gameCode, game);
    game = await runVotes(players, gameCode, game, imposter.id);

    assert(game.lastRoundResult.winner === 'civilians', 'winner should be civilians');
    assert(game.status === 'ended', 'game should be ended');
    console.log('  ✓ civilians win');
    disconnectAll(players);
}

async function imposterWins() {
    console.log('\n[imposter-wins] Players vote out a civilian; imposter wins');
    const players  = await createClients(['Alice', 'Bob', 'Carol']);
    const gameCode = await setupGame(players);
    let game       = await startGame(players, gameCode);

    const civilian = game.players.find((p) => p.role === 'civilian');
    const imposter = game.players.find((p) => p.role === 'imposter');
    console.log(`  voting out civilian: ${civilian.name} | imposter is: ${imposter.name}`);

    game = await runDescriptions(players, gameCode, game);
    game = await runVotes(players, gameCode, game, civilian.id);

    assert(game.lastRoundResult.winner === 'imposter', 'winner should be imposter');
    assert(game.status === 'ended', 'game should be ended');
    console.log('  ✓ imposter wins');
    disconnectAll(players);
}

async function tieVote() {
    console.log('\n[tie-vote] Tie in round 1 → no elimination → civilians win round 2 (~5s wait)');
    const players  = await createClients(['Alice', 'Bob', 'Carol', 'Dave']);
    const gameCode = await setupGame(players);
    let game       = await startGame(players, gameCode);

    // --- Round 1: force a 2-2 tie ---
    game = await runDescriptions(players, gameCode, game);

    const [p0, p1, p2, p3] = game.players;
    // p0 and p1 each get 2 votes → tie
    const resultsPhase = waitForGameState(
        players[0].socket,
        (g) => g.gamePhase === 'results',
        6000
    );
    players.find((s) => s.playerId === p0.id).socket.emit('submit-vote', { gameCode, votedPlayerId: p1.id });
    players.find((s) => s.playerId === p1.id).socket.emit('submit-vote', { gameCode, votedPlayerId: p0.id });
    players.find((s) => s.playerId === p2.id).socket.emit('submit-vote', { gameCode, votedPlayerId: p1.id });
    players.find((s) => s.playerId === p3.id).socket.emit('submit-vote', { gameCode, votedPlayerId: p0.id });
    game = await resultsPhase;

    assert(game.lastRoundResult.winner === null, 'no winner on tie');
    assert(game.players.every((p) => p.status !== 'eliminated'), 'no one eliminated on tie');
    console.log('  ✓ round 1: tie — no elimination');

    // Server auto-starts round 2 after 5s
    console.log('  waiting for server to start round 2...');
    game = await waitForGameState(
        players[0].socket,
        (g) => g.currentRound === 2 && g.gamePhase === 'description',
        10000
    );
    console.log('  ✓ round 2 started');

    // --- Round 2: all vote for imposter ---
    game = await runDescriptions(players, gameCode, game);
    const imposter = game.players.find((p) => p.role === 'imposter');
    game = await runVotes(players, gameCode, game, imposter.id);

    assert(game.lastRoundResult.winner === 'civilians', 'civilians should win in round 2');
    console.log('  ✓ round 2: civilians win');
    disconnectAll(players);
}

async function reconnect() {
    console.log('\n[reconnect] Player disconnects right after game starts and reconnects');
    const players  = await createClients(['Alice', 'Bob', 'Carol', 'Dave']);
    const gameCode = await setupGame(players);
    let game       = await startGame(players, gameCode);

    // Carol disconnects
    const carol       = players[2];
    const savedId     = carol.playerId;
    const savedName   = carol.name;
    console.log(`  ${savedName} disconnecting...`);
    carol.socket.disconnect();
    await delay(300);

    // Reconnect with a fresh socket using previousPlayerId
    console.log(`  ${savedName} reconnecting...`);
    const newSocket = io(SERVER_URL, { transports: ['websocket'] });
    await waitForEvent(newSocket, 'connect');
    newSocket.on('game-state-update', (g) => { carol.gameState = g; });
    newSocket.on('error', (err) => console.log(`  [${savedName}] error: ${err.message}`));

    newSocket.emit('join-game', { gameCode, playerName: savedName, previousPlayerId: savedId });
    const rejoined = await waitForEvent(newSocket, 'game-joined');

    assert(rejoined.playerId === savedId, 'reconnected player should keep same ID');
    const reconnectedState = rejoined.gameState.players.find((p) => p.id === savedId);
    assert(reconnectedState.status === 'active', 'reconnected player should be active');

    carol.socket   = newSocket;
    carol.playerId = rejoined.playerId;
    game           = rejoined.gameState;
    console.log(`  ✓ ${savedName} reconnected with same player ID`);

    // Complete game normally
    game = await runDescriptions(players, gameCode, game);
    const imposter = game.players.find((p) => p.role === 'imposter');
    game = await runVotes(players, gameCode, game, imposter.id);

    assert(game.lastRoundResult.winner === 'civilians', 'civilians should win after reconnect');
    console.log('  ✓ game completed normally after reconnect');
    disconnectAll(players);
}

/**
 * Reproduces the mobile share-link bug:
 *   Creator copies invite link → switches to another app → browser suspends the tab
 *   → socket drops (new socket ID on return) → server loses session mapping
 *   → other players see creator as disconnected/inactive.
 *
 * The fix (client.js): re-emit join-game with previousPlayerId on every socket
 * connect event when a valid session exists on /lobby or /game.
 *
 * This scenario simulates what the fixed client does on socket reconnect.
 */
async function mobileSuspend() {
    console.log('\n[mobile-suspend] Creator leaves browser to share link; socket drops and reconnects');
    const players  = await createClients(['Alice', 'Bob', 'Carol']);
    const gameCode = await setupGame(players);

    const creator   = players[0]; // Alice — the host
    const savedId   = creator.playerId;
    const savedName = creator.name;

    // --- Step 1: confirm everyone sees creator as active before suspension ---
    const bobInitialView = players[1].gameState?.players.find((p) => p.id === savedId);
    assert(bobInitialView?.status === 'active', 'creator should be active before suspension');

    // --- Step 2: simulate mobile browser suspension (socket drops) ---
    console.log(`  ${savedName} leaves browser to share link (socket drops)...`);
    creator.socket.disconnect();
    await delay(400);

    // Server marks creator disconnected immediately; other players receive game-state-update
    const bobMidView = players[1].gameState?.players.find((p) => p.id === savedId);
    assert(bobMidView?.status === 'disconnected', 'creator should appear disconnected while away');
    console.log('  ✓ other players see creator as disconnected while away');

    // --- Step 3: browser tab resumes — socket gets new ID ---
    // The fix in client.js: on 'connect', if session exists on /lobby or /game,
    // auto-emit join-game with previousPlayerId. We reproduce that here.
    console.log(`  ${savedName} returns to browser (new socket, auto re-joins via session)...`);
    const newSocket = io(SERVER_URL, { transports: ['websocket'] });
    await waitForEvent(newSocket, 'connect');
    newSocket.on('game-state-update', (g) => { creator.gameState = g; });
    newSocket.on('error', (err) => console.log(`  [${savedName}] error: ${err.message}`));

    // This is exactly what the fixed client.js connect handler does
    newSocket.emit('join-game', { gameCode, playerName: savedName, previousPlayerId: savedId });
    const rejoined = await waitForEvent(newSocket, 'game-joined');

    assert(rejoined.playerId === savedId, 'creator should rejoin with same player ID');
    const rejoinedState = rejoined.gameState.players.find((p) => p.id === savedId);
    assert(rejoinedState.status === 'active', 'creator should be active after returning');
    creator.socket   = newSocket;
    creator.playerId = rejoined.playerId;
    console.log(`  ✓ ${savedName} restored with same ID, status: active`);

    // --- Step 4: verify other players see creator as active again ---
    await delay(300);
    const bobFinalView = players[1].gameState?.players.find((p) => p.id === savedId);
    assert(bobFinalView?.status === 'active', 'other players should see creator as active again');
    console.log('  ✓ other players now see creator as active');

    disconnectAll(players);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const SCENARIOS = {
    'happy-path':    happyPath,
    'imposter-wins': imposterWins,
    'tie-vote':      tieVote,
    'reconnect':     reconnect,
    'mobile-suspend': mobileSuspend,
};

async function main() {
    console.log(`Server: ${SERVER_URL}`);

    if (SCENARIO !== 'all' && !SCENARIOS[SCENARIO]) {
        console.error(`Unknown scenario "${SCENARIO}". Available: ${Object.keys(SCENARIOS).join(', ')}, all`);
        process.exit(1);
    }

    const toRun = SCENARIO === 'all' ? Object.keys(SCENARIOS) : [SCENARIO];
    const results = [];

    for (const name of toRun) {
        try {
            await SCENARIOS[name]();
            results.push({ name, passed: true });
        } catch (err) {
            console.log(`  ✗ FAILED: ${err.message}`);
            results.push({ name, passed: false, error: err.message });
        }
        await delay(300);
    }

    console.log('\n--- Simulation Results ---');
    for (const r of results) {
        console.log(`  ${r.passed ? '✓' : '✗'} ${r.name}${r.passed ? '' : ` — ${r.error}`}`);
    }

    const failed = results.filter((r) => !r.passed).length;
    console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
