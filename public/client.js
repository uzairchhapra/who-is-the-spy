const socket = io();

// Shared state
let currentUser = null;
let currentGameCode = null;

// Helpers
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

function saveSession(gameCode, playerId, playerName) {
    sessionStorage.setItem('gameCode', gameCode);
    sessionStorage.setItem('playerId', playerId);
    sessionStorage.setItem('playerName', playerName);
}

function getSession() {
    return {
        gameCode: sessionStorage.getItem('gameCode'),
        playerId: sessionStorage.getItem('playerId'),
        playerName: sessionStorage.getItem('playerName')
    };
}

function clearSession() {
    sessionStorage.clear();
}

// Common Socket Listeners
socket.on('connect', () => {
    console.log('Connected to server', socket.id);
    // Optional: Attempt reconnect if session exists
    const session = getSession();
    if (session.gameCode && window.location.pathname.includes('game.html')) {
        // Re-join logic could go here if we want robust reconnection
        // socket.emit('join-game', { gameCode: session.gameCode, playerName: session.playerName });
    }
});

socket.on('error', (data) => {
    alert(data.message);
});

// UI Helpers
function updateElement(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Show toast or temporary message
        const btn = document.getElementById('copyBtn');
        if (btn) {
            const originalText = btn.innerHTML;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.innerHTML = originalText, 2000);
        }
    });
}
