const socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 20000
});

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

// Random Name Generator
const adjectives = [
    'Happy', 'Lucky', 'Swift', 'Brave', 'Clever', 'Mighty', 'Noble', 'Silent',
    'Golden', 'Silver', 'Crystal', 'Mystic', 'Ancient', 'Cosmic', 'Electric',
    'Blazing', 'Frozen', 'Thunder', 'Shadow', 'Radiant', 'Crimson', 'Azure',
    'Emerald', 'Amber', 'Jade', 'Scarlet', 'Violet', 'Turquoise', 'Coral',
    'Ruby', 'Diamond', 'Pearl', 'Sapphire', 'Topaz', 'Obsidian', 'Ivory'
];

const nouns = [
    'Lion', 'Tiger', 'Eagle', 'Wolf', 'Bear', 'Dragon', 'Phoenix', 'Falcon',
    'Panther', 'Hawk', 'Raven', 'Cobra', 'Shark', 'Whale', 'Dolphin',
    'Fox', 'Owl', 'Jaguar', 'Leopard', 'Cheetah', 'Lynx', 'Puma', 'Otter',
    'Penguin', 'Sparrow', 'Crow', 'Heron', 'Swan', 'Flamingo', 'Peacock',
    'Butterfly', 'Dragonfly', 'Firefly', 'Beetle', 'Mantis', 'Scorpion'
];

function generateRandomName() {
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adjective}${noun}`;
}
