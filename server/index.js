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
 *   hostId,
 *   players: [{id,name}],
 *   game: {
 *     started: bool,
 *     deck: string[],
 *     community: string[],
 *     hole: { [socketId]: string[] }
 *   }
 * }
 */
const rooms = {};

function makeCode(len = 4) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function makeDeck() {
  const suits = ["S", "H", "D", "C"]; // spades, hearts, diamonds, clubs
  const ranks = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(r + s);
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function safeRoom(code, forSocketId = null) {
  const r = rooms[code];
  if (!r) return null;

  const started = !!r.game?.started;
  const community = r.game?.community || [];

  // only show each player THEIR OWN hole cards
  const myHole = forSocketId && r.game?.hole?.[forSocketId] ? r.game.hole[forSocketId] : [];

  return {
    code,
    hostId: r.hostId,
    players: r.players,
    game: {
      started,
      community,
      myHole
    }
  };
}

function broadcastRoom(code) {
  const r = rooms[code];
  if (!r) return;
  for (const p of r.players) {
    io.to(p.id).emit("room:update", safeRoom(code, p.id));
  }
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("room:create", ({ name }, cb) => {
    const playerName = (name || "Player").toString().slice(0, 16);

    let code = makeCode();
    while (rooms[code]) code = makeCode();

    rooms[code] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName }],
      game: { started: false, deck: [], community: [], hole: {} }
    };

    socket.join(code);
    socket.data.roomCode = code;

    broadcastRoom(code);
    cb?.({ ok: true, room: safeRoom(code, socket.id) });
  });

  socket.on("room:join", ({ code, name }, cb) => {
    const roomCode = (code || "").toString().trim().toUpperCase();
    const playerName = (name || "Player").toString().slice(0, 16);

    if (!rooms[roomCode]) return cb?.({ ok: false, error: "Room not found." });

    const r = rooms[roomCode];
    if (!r.players.some(p => p.id === socket.id)) {
      r.players.push({ id: socket.id, name: playerName });
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    broadcastRoom(roomCode);
    cb?.({ ok: true, room: safeRoom(roomCode, socket.id) });
  });

  socket.on("room:leave", (cb) => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return cb?.({ ok: true });

    const r = rooms[code];
    r.players = r.players.filter(p => p.id !== socket.id);
    delete r.game.hole[socket.id];

    socket.leave(code);
    socket.data.roomCode = null;

    if (r.hostId === socket.id) r.hostId = r.players[0]?.id || null;

    if (r.players.length === 0) delete rooms[code];
    else broadcastRoom(code);

    cb?.({ ok: true });
  });

  // START GAME (host only): deal 2 cards to each, + set community empty
  socket.on("game:start", (cb) => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return cb?.({ ok: false, error: "Not in a room." });

    const r = rooms[code];
    if (r.hostId !== socket.id) return cb?.({ ok: false, error: "Only host can start." });
    if (r.players.length < 2) return cb?.({ ok: false, error: "Need 2+ players." });

    const deck = shuffle(makeDeck());
    const hole = {};

    for (const p of r.players) {
      hole[p.id] = [deck.pop(), deck.pop()];
    }

    r.game = {
      started: true,
      deck,
      community: [],
      hole
    };

    broadcastRoom(code);
    cb?.({ ok: true });
  });

  // DEAL COMMUNITY (host only): flop/turn/river in order
  socket.on("game:dealCommunity", (cb) => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return cb?.({ ok: false, error: "Not in a room." });

    const r = rooms[code];
    if (r.hostId !== socket.id) return cb?.({ ok: false, error: "Only host can deal." });
    if (!r.game?.started) return cb?.({ ok: false, error: "Game not started." });

    const g = r.game;

    // Burn card (optional feel)
    if (g.deck.length > 0) g.deck.pop();

    if (g.community.length === 0) {
      // flop = 3 cards
      g.community.push(g.deck.pop(), g.deck.pop(), g.deck.pop());
    } else if (g.community.length === 3) {
      // turn = 1
      g.community.push(g.deck.pop());
    } else if (g.community.length === 4) {
      // river = 1
      g.community.push(g.deck.pop());
    } else {
      return cb?.({ ok: false, error: "Community already complete." });
    }

    broadcastRoom(code);
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;

    const r = rooms[code];
    r.players = r.players.filter(p => p.id !== socket.id);
    delete r.game?.hole?.[socket.id];

    if (r.hostId === socket.id) r.hostId = r.players[0]?.id || null;

    if (r.players.length === 0) delete rooms[code];
    else broadcastRoom(code);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("Server running on port", PORT));
