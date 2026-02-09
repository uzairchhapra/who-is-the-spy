# Who's the Spy 🕵️‍♂️

A real-time, multiplayer social deduction game built with **Node.js**, **Socket.io**, and **Modern Vanilla CSS**. Inspired by games like "Imposter" and "Undercover", players must describe their secret words and find the imposter among them before the imposter learns the civilian word!

## ✨ Features

- **Real-time Gameplay**: Instant communication via WebSockets for seamless multiplayer.
- **Modern UI/UX**: Premium dark-mode aesthetic with fluid transitions and responsive layouts.
- **Dynamic Role Management**: Automatic role distribution and turn rotation.
- **Seamless Reconnection**: Stay in the game even if your connection drops.
- **No Install Required**: Lightweight, vanilla web experience that works on mobile and desktop.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- **NPM** (comes with Node.js)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/uzair-chhapra/who-is-the-spy.git
   cd who-is-the-spy
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open your browser and navigate to `http://localhost:3000`.

## 🎮 How to Play

1. **Join the Lobby**: One player creates a game and shares the 6-digit code with friends.
2. **Roles Assigned**: 
   - **Civilians**: Get the same secret word.
   - **Imposter**: Gets a slightly different word (or a relative one).
3. **Describe**: Each player takes turns giving a one-word description of their secret word. Be careful not to be too obvious!
4. **Vote**: After everyone has described, players vote on who they think the imposter is.
5. **Win Conditions**:
   - **Civilians Win**: If they correctly identify and eliminate the imposter.
   - **Imposter Wins**: If they survive until there are only two players left, or if they correctly guess the civilian word (in variations).

## 🛠 Tech Stack

- **Backend**: Node.js, Express
- **Real-time**: Socket.io
- **Frontend**: HTML5, Vanilla JavaScript, CSS3 (Custom Design System)

## 🐳 Docker Support

Run the application using Docker:

```bash
docker build -t who-is-the-spy .
docker run -p 3000:3000 who-is-the-spy
```

## 📖 Documentation

- **[Technical Implementation Guide](docs/TECHNICAL.md)** - Deep dive into the game architecture, Socket.io events, state machine, and core game logic.

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

*Made with ❤️ for great game nights.*
