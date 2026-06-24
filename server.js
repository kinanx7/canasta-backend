const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

// Enable CORS for Socket.io so your frontend can connect from anywhere
const io = new Server(server, {
    cors: {
        origin: "*", // We will restrict this to your GitHub Pages URL later
        methods: ["GET", "POST"]
    }
});

// Database of active game rooms
const rooms = {};

// Helper: Generate a random 6-character room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- CREATE ROOM ---
    socket.on('createRoom', (data, callback) => {
        const roomCode = generateRoomCode();

        // Initialize room state
        rooms[roomCode] = {
            hostId: socket.id,
            players: [
                { id: socket.id, name: data.playerName || 'Host Player', type: 'human', isHost: true },
                null, null, null // Empty slots
            ],
            gameState: {} // We will put the cards here later
        };

        socket.join(roomCode);
        console.log(`Room created: ${roomCode} by ${socket.id}`);

        // Send the room code and initial player list back to the host
        callback({ success: true, roomCode: roomCode, players: rooms[roomCode].players });
    });

    // --- JOIN ROOM ---
    socket.on('joinRoom', (data, callback) => {
        const roomCode = data.roomCode.toUpperCase();
        const room = rooms[roomCode];

        if (!room) {
            return callback({ success: false, message: "Room not found." });
        }

        // Find the first empty slot
        const emptySlotIndex = room.players.findIndex(p => p === null);

        if (emptySlotIndex === -1) {
            return callback({ success: false, message: "Room is full!" });
        }

        // Add player to the room
        const newPlayer = { id: socket.id, name: data.playerName || 'Guest Player', type: 'human', isHost: false };
        room.players[emptySlotIndex] = newPlayer;

        socket.join(roomCode);
        console.log(`${socket.id} joined room: ${roomCode}`);

        // Tell the joining player they succeeded
        callback({ success: true, roomCode: roomCode, players: room.players });

        // Broadcast the updated player list to everyone ELSE in the room
        socket.to(roomCode).emit('lobbyUpdated', room.players);
    });

    // --- ADD / KICK BOTS ---
    socket.on('updateBot', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.hostId === socket.id) {
            if (data.action === 'add') {
                room.players[data.index] = { id: 'bot_' + Math.random(), name: data.botName, type: 'bot', isHost: false };
            } else if (data.action === 'remove') {
                room.players[data.index] = null;
            }
            io.to(data.roomCode).emit('lobbyUpdated', room.players); // Sync to everyone
        }
    });

    // --- SWAP TEAMS ---
    socket.on('swapTeams', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.hostId === socket.id) {
            // Swap slot 1 and slot 2 to mix partners!
            const temp = room.players[1];
            room.players[1] = room.players[2];
            room.players[2] = temp;

            io.to(data.roomCode).emit('lobbyUpdated', room.players); // Sync to everyone
        }
    });

    // --- CHOOSE SEAT ---
    socket.on('chooseSeat', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        // Find the player's current slot
        const myIndex = room.players.findIndex(p => p && p.id === socket.id);
        if (myIndex === -1) return;

        const targetIndex = data.index;
        if (targetIndex < 0 || targetIndex > 3 || targetIndex === myIndex) return;

        const targetPlayer = room.players[targetIndex];

        if (targetPlayer === null) {
            // Target slot is empty. Move player there.
            room.players[targetIndex] = room.players[myIndex];
            room.players[myIndex] = null;
            io.to(data.roomCode).emit('lobbyUpdated', room.players);
        } else if (targetPlayer.type === 'bot') {
            // Target slot is a bot. Swap player with bot.
            room.players[targetIndex] = room.players[myIndex];
            room.players[myIndex] = targetPlayer;
            io.to(data.roomCode).emit('lobbyUpdated', room.players);
        }
    });

    // --- START GAME ---
    socket.on('startGame', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.hostId === socket.id) {
            io.to(data.roomCode).emit('gameStarted', room.players); // Tell everyone to launch the game screen!
        }
    });

    // --- SYNC GAME STATE (THE DEAL) ---
    socket.on('syncGameState', (data) => {
        // The Host sends the shuffled deck and placements here, we broadcast it to the Guests
        socket.to(data.roomCode).emit('gameStateUpdated', data.state);
    });

    // --- SYNC LIVE MOVES ---
    socket.on('sendMove', (data) => {
        // When a player draws, discards, or melds, broadcast the animation to everyone else
        socket.to(data.roomCode).emit('playerMoved', data);
    });

    // --- HANDLE DISCONNECTS ---
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // We will add logic here later to handle when a player drops mid-game
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Canasta Multiplayer Server running on port ${PORT}`);
});