import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);

const ORIGINS = [
  "https://poker-online-livid.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000"
];

const io = new Server(server, {
  cors: { origin: ORIGINS, methods: ["GET", "POST"] }
});

app.use(cors({ origin: ORIGINS }));

app.get("/", (req, res) => res.send("Poker server is running"));

/**
 * rooms[code] = {
 *   hostId: string,
 *   players: [{ id, name }]
 * }
 */
const rooms = {};

function makeCode(len = 4) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusing I/O/1/0
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function safeRoom(code) {
  const r = rooms[code];
  if (!r) return null;
  return {
    code,
    hostId: r.hostId,
    players: r.players
  };
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("room:create", ({ name }, cb) => {
    try {
      const playerName = (name || "Player").toString().slice(0, 16);

      let code = makeCode();
      while (rooms[code]) code = makeCode();

      rooms[code] = {
        hostId: socket.id,
        players: [{ id: socket.id, name: playerName }]
      };

      socket.join(code);
      socket.data.roomCode = code;

      io.to(code).emit("room:update", safeRoom(code));
      cb?.({ ok: true, room: safeRoom(code) });
    } catch (e) {
      cb?.({ ok: false, error: "Failed to create room." });
    }
  });

  socket.on("room:join", ({ code, name }, cb) => {
    try {
      const roomCode = (code || "").toString().trim().toUpperCase();
      const playerName = (name || "Player").toString().slice(0, 16);

      if (!rooms[roomCode]) return cb?.({ ok: false, error: "Room not found." });

      const r = rooms[roomCode];

      // prevent duplicates
      const exists = r.players.some(p => p.id === socket.id);
      if (!exists) r.players.push({ id: socket.id, name: playerName });

      socket.join(roomCode);
      socket.data.roomCode = roomCode;

      io.to(roomCode).emit("room:update", safeRoom(roomCode));
      cb?.({ ok: true, room: safeRoom(roomCode) });
    } catch (e) {
      cb?.({ ok: false, error: "Failed to join room." });
    }
  });

  socket.on("room:leave", (cb) => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return cb?.({ ok: true });

    const r = rooms[code];
    r.players = r.players.filter(p => p.id !== socket.id);
    socket.leave(code);
    socket.data.roomCode = null;

    // if host left, give host to first player
    if (r.hostId === socket.id) {
      r.hostId = r.players[0]?.id || null;
    }

    // delete empty rooms
    if (r.players.length === 0) {
      delete rooms[code];
    } else {
      io.to(code).emit("room:update", safeRoom(code));
    }

    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;

    const r = rooms[code];
    r.players = r.players.filter(p => p.id !== socket.id);

    if (r.hostId === socket.id) {
      r.hostId = r.players[0]?.id || null;
    }

    if (r.players.length === 0) {
      delete rooms[code];
    } else {
      io.to(code).emit("room:update", safeRoom(code));
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("Server running on port", PORT));
