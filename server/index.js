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
 *   players: [{id,name,stack,seat}],
 *   game: { ... }
 * }
 */
const rooms = {};

const STARTING_STACK = 1000;
const SB = 10;
const BB = 20;

function makeCode(len = 4) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function makeDeck() {
  const suits = ["S", "H", "D", "C"];
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

function rankVal(r) {
  return "23456789TJQKA".indexOf(r) + 2;
}

/** 5-card evaluator -> returns score array; bigger is better */
function eval5(cards) {
  // cards like ["AS","KD","TH","2C","2D"]
  const ranks = cards.map(c => c[0]).map(rankVal).sort((a,b)=>b-a);
  const suits = cards.map(c => c[1]);

  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;

  const groups = Object.entries(counts)
    .map(([r,c]) => ({ r: parseInt(r,10), c }))
    .sort((a,b) => b.c - a.c || b.r - a.r);

  const isFlush = suits.every(s => s === suits[0]);

  // straight check (handle wheel A-5)
  const unique = [...new Set(ranks)].sort((a,b)=>b-a);
  let isStraight = false;
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) {
      isStraight = true;
      straightHigh = unique[0];
    } else {
      // wheel: A 5 4 3 2
      const wheel = [14,5,4,3,2];
      if (wheel.every(v => unique.includes(v))) {
        isStraight = true;
        straightHigh = 5;
      }
    }
  }

  // Category order:
  // 8 Straight Flush, 7 Four, 6 Full House, 5 Flush, 4 Straight, 3 Trips, 2 Two Pair, 1 Pair, 0 High
  if (isStraight && isFlush) return [8, straightHigh];

  if (groups[0].c === 4) {
    const four = groups[0].r;
    const kicker = groups[1].r;
    return [7, four, kicker];
  }

  if (groups[0].c === 3 && groups[1].c === 2) {
    return [6, groups[0].r, groups[1].r];
  }

  if (isFlush) return [5, ...unique]; // high cards

  if (isStraight) return [4, straightHigh];

  if (groups[0].c === 3) {
    const trips = groups[0].r;
    const kickers = groups.slice(1).map(g=>g.r).sort((a,b)=>b-a);
    return [3, trips, ...kickers];
  }

  if (groups[0].c === 2 && groups[1].c === 2) {
    const hiPair = Math.max(groups[0].r, groups[1].r);
    const loPair = Math.min(groups[0].r, groups[1].r);
    const kicker = groups[2].r;
    return [2, hiPair, loPair, kicker];
  }

  if (groups[0].c === 2) {
    const pair = groups[0].r;
    const kickers = groups.slice(1).map(g=>g.r).sort((a,b)=>b-a);
    return [1, pair, ...kickers];
  }

  return [0, ...unique];
}

function cmpScore(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function bestOf7(cards7) {
  // choose best 5 of 7 => 21 combos
  let best = null;
  let bestHand = null;
  const n = cards7.length;
  for (let a=0;a<n;a++) for (let b=a+1;b<n;b++) for (let c=b+1;c<n;c++) for (let d=c+1;d<n;d++) for (let e=d+1;e<n;e++) {
    const hand = [cards7[a],cards7[b],cards7[c],cards7[d],cards7[e]];
    const sc = eval5(hand);
    if (!best || cmpScore(sc, best) > 0) {
      best = sc;
      bestHand = hand;
    }
  }
  return { score: best, hand: bestHand };
}

function getRoom(code) { return rooms[code] || null; }

function ensureGame(r) {
  if (!r.game) r.game = {};
}

function safeRoom(code, forId) {
  const r = getRoom(code);
  if (!r) return null;

  const g = r.game || {};
  const started = !!g.started;

  const myHole = started && g.hole && g.hole[forId] ? g.hole[forId] : [];

  return {
    code,
    hostId: r.hostId,
    players: r.players.map(p => ({
      id: p.id,
      name: p.name,
      stack: p.stack,
      seat: p.seat
    })),
    game: {
      started,
      street: g.street || "lobby", // lobby|preflop|flop|turn|river|showdown
      dealerSeat: g.dealerSeat ?? 0,
      toActSeat: g.toActSeat ?? 0,
      pot: g.pot ?? 0,
      currentBet: g.currentBet ?? 0,
      community: g.community || [],
      myHole
    }
  };
}

function broadcastRoom(code) {
  const r = getRoom(code);
  if (!r) return;
  for (const p of r.players) {
    io.to(p.id).emit("room:update", safeRoom(code, p.id));
  }
}

function seatSort(players) {
  return [...players].sort((a,b)=>a.seat-b.seat);
}

function nextOccupiedSeat(r, fromSeat) {
  const players = seatSort(r.players);
  const seats = players.map(p=>p.seat);
  if (seats.length === 0) return 0;
  const max = Math.max(...seats);
  let s = fromSeat;
  for (let i=0;i<max+10;i++) {
    s = s + 1;
    const candidate = seats.includes(s) ? s : null;
    if (candidate !== null) return candidate;
  }
  return seats[0];
}

function playerBySeat(r, seat) {
  return r.players.find(p=>p.seat===seat) || null;
}

function activePlayers(r) {
  const g = r.game;
  return r.players.filter(p => !g.folded[p.id] && g.inHand[p.id]);
}

function setupNewHand(r) {
  ensureGame(r);
  const g = r.game;

  // remove broke players
  r.players = r.players.filter(p => p.stack > 0);

  // need 2+ players
  if (r.players.length < 2) {
    g.started = false;
    g.street = "lobby";
    return;
  }

  // rotate dealer
  g.dealerSeat = (g.dealerSeat ?? 0);
  const seats = seatSort(r.players).map(p=>p.seat);
  if (!seats.includes(g.dealerSeat)) g.dealerSeat = seats[0];
  g.dealerSeat = nextOccupiedSeat(r, g.dealerSeat - 1);

  g.deck = shuffle(makeDeck());
  g.community = [];
  g.hole = {};
  g.pot = 0;
  g.currentBet = 0;
  g.street = "preflop";

  g.inHand = {};
  g.folded = {};
  g.betThisStreet = {};
  g.actedThisStreet = {};

  for (const p of r.players) {
    g.inHand[p.id] = true;
    g.folded[p.id] = false;
    g.betThisStreet[p.id] = 0;
    g.actedThisStreet[p.id] = false;
  }

  // deal hole cards
  for (const p of r.players) {
    g.hole[p.id] = [g.deck.pop(), g.deck.pop()];
  }

  // blinds
  const sbSeat = nextOccupiedSeat(r, g.dealerSeat);
  const bbSeat = nextOccupiedSeat(r, sbSeat);

  const sbP = playerBySeat(r, sbSeat);
  const bbP = playerBySeat(r, bbSeat);

  const postBlind = (pl, amt) => {
    const a = Math.min(pl.stack, amt);
    pl.stack -= a;
    g.pot += a;
    g.betThisStreet[pl.id] += a;
    g.currentBet = Math.max(g.currentBet, g.betThisStreet[pl.id]);
  };

  postBlind(sbP, SB);
  postBlind(bbP, BB);

  // action starts left of BB (next seat)
  g.toActSeat = nextOccupiedSeat(r, bbSeat);

  // mark blinds as acted? (no)
  g.actedThisStreet[sbP.id] = false;
  g.actedThisStreet[bbP.id] = false;
}

function resetStreetFlags(r) {
  const g = r.game;
  g.currentBet = 0;
  for (const p of r.players) {
    g.betThisStreet[p.id] = 0;
    g.actedThisStreet[p.id] = false;
  }
}

function dealNextStreet(r) {
  const g = r.game;

  // burn
  if (g.deck.length > 0) g.deck.pop();

  if (g.street === "preflop") {
    g.community.push(g.deck.pop(), g.deck.pop(), g.deck.pop());
    g.street = "flop";
  } else if (g.street === "flop") {
    g.community.push(g.deck.pop());
    g.street = "turn";
  } else if (g.street === "turn") {
    g.community.push(g.deck.pop());
    g.street = "river";
  } else if (g.street === "river") {
    g.street = "showdown";
  }

  resetStreetFlags(r);

  // first to act is left of dealer (on flop+)
  const firstSeat = nextOccupiedSeat(r, g.dealerSeat);
  g.toActSeat = firstSeat;
}

function onlyOneLeft(r) {
  return activePlayers(r).length === 1;
}

function awardToLastPlayer(r) {
  const g = r.game;
  const winner = activePlayers(r)[0];
  if (!winner) return;
  winner.stack += g.pot;
  g.pot = 0;
  g.street = "showdown";
  g.showdown = { winners: [winner.id], reason: "Everyone folded" };
}

function showdown(r) {
  const g = r.game;
  const alive = activePlayers(r);
  if (alive.length === 0) return;

  let best = null;
  let winners = [];

  for (const p of alive) {
    const seven = [...g.hole[p.id], ...g.community];
    const { score } = bestOf7(seven);
    if (!best || cmpScore(score, best) > 0) {
      best = score;
      winners = [p.id];
    } else if (cmpScore(score, best) === 0) {
      winners.push(p.id);
    }
  }

  const share = Math.floor(g.pot / winners.length);
  for (const id of winners) {
    const pl = r.players.find(x=>x.id===id);
    if (pl) pl.stack += share;
  }
  g.pot = 0;
  g.street = "showdown";
  g.showdown = { winners, reason: "Showdown" };
}

function streetBettingComplete(r) {
  const g = r.game;
  const alive = activePlayers(r);
  if (alive.length <= 1) return true;

  // everyone alive has acted AND their bet equals currentBet
  return alive.every(p => g.actedThisStreet[p.id] && g.betThisStreet[p.id] === g.currentBet);
}

function advanceIfNeeded(r) {
  const g = r.game;

  if (onlyOneLeft(r)) {
    awardToLastPlayer(r);
    return;
  }

  if (streetBettingComplete(r)) {
    if (g.street === "river") {
      showdown(r);
      return;
    }
    dealNextStreet(r);
    return;
  }
}

function moveToNextActor(r) {
  const g = r.game;
  if (onlyOneLeft(r)) return;

  let s = g.toActSeat;
  for (let i=0;i<50;i++) {
    s = nextOccupiedSeat(r, s);
    const p = playerBySeat(r, s);
    if (!p) continue;
    if (g.inHand[p.id] && !g.folded[p.id]) {
      g.toActSeat = s;
      return;
    }
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
      players: [{ id: socket.id, name: playerName, stack: STARTING_STACK, seat: 0 }],
      game: { started: false, street: "lobby" }
    };

    socket.join(code);
    socket.data.roomCode = code;

    broadcastRoom(code);
    cb?.({ ok: true });
  });

  socket.on("room:join", ({ code, name }, cb) => {
    const roomCode = (code || "").toString().trim().toUpperCase();
    const playerName = (name || "Player").toString().slice(0, 16);

    const r = getRoom(roomCode);
    if (!r) return cb?.({ ok: false, error: "Room not found." });

    if (!r.players.some(p => p.id === socket.id)) {
      const usedSeats = new Set(r.players.map(p=>p.seat));
      let seat = 0;
      while (usedSeats.has(seat)) seat++;
      r.players.push({ id: socket.id, name: playerName, stack: STARTING_STACK, seat });
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    broadcastRoom(roomCode);
    cb?.({ ok: true });
  });

  socket.on("room:leave", (cb) => {
    const code = socket.data.roomCode;
    const r = getRoom(code);
    if (!code || !r) return cb?.({ ok: true });

    r.players = r.players.filter(p => p.id !== socket.id);

    socket.leave(code);
    socket.data.roomCode = null;

    if (r.hostId === socket.id) r.hostId = r.players[0]?.id || null;

    if (r.players.length === 0) delete rooms[code];
    else broadcastRoom(code);

    cb?.({ ok: true });
  });

  socket.on("game:start", (cb) => {
    const code = socket.data.roomCode;
    const r = getRoom(code);
    if (!r) return cb?.({ ok: false, error: "Not in room." });
    if (r.hostId !== socket.id) return cb?.({ ok: false, error: "Host only." });
    if (r.players.length < 2) return cb?.({ ok: false, error: "Need 2+ players." });

    r.game.started = true;
    r.game.dealerSeat = r.game.dealerSeat ?? 0;

    setupNewHand(r);
    broadcastRoom(code);
    cb?.({ ok: true });
  });

  socket.on("game:action", ({ type, raiseTo }, cb) => {
    const code = socket.data.roomCode;
    const r = getRoom(code);
    if (!r || !r.game?.started) return cb?.({ ok: false, error: "No game." });

    const g = r.game;

    const actor = r.players.find(p=>p.id===socket.id);
    if (!actor) return cb?.({ ok: false, error: "Not a player." });

    // must be actor's turn
    if (actor.seat !== g.toActSeat) return cb?.({ ok: false, error: "Not your turn." });
    if (g.folded[actor.id]) return cb?.({ ok: false, error: "You folded." });

    const toCall = Math.max(0, g.currentBet - g.betThisStreet[actor.id]);

    const putChips = (amt) => {
      const a = Math.max(0, Math.min(actor.stack, amt));
      actor.stack -= a;
      g.pot += a;
      g.betThisStreet[actor.id] += a;
      g.currentBet = Math.max(g.currentBet, g.betThisStreet[actor.id]);
      return a;
    };

    if (type === "fold") {
      g.folded[actor.id] = true;
      g.actedThisStreet[actor.id] = true;
    }

    else if (type === "check") {
      if (toCall !== 0) return cb?.({ ok: false, error: "You must call or fold." });
      g.actedThisStreet[actor.id] = true;
    }

    else if (type === "call") {
      if (toCall === 0) return cb?.({ ok: false, error: "Nothing to call (check)." });
      putChips(toCall);
      g.actedThisStreet[actor.id] = true;
    }

    else if (type === "raise") {
      // raiseTo is TOTAL bet for this street (like raising to 60)
      let target = Number(raiseTo);
      if (!Number.isFinite(target)) return cb?.({ ok: false, error: "Bad raise amount." });

      // minimum raise: currentBet + BB (simple)
      const min = g.currentBet + BB;
      if (target < min) target = min;

      const needTotal = target - g.betThisStreet[actor.id];
      if (needTotal <= 0) return cb?.({ ok: false, error: "Raise must increase bet." });

      putChips(needTotal);

      // when raise happens, everyone else must act again
      for (const p of r.players) {
        if (p.id !== actor.id && !g.folded[p.id]) g.actedThisStreet[p.id] = false;
      }
      g.actedThisStreet[actor.id] = true;
    }

    else {
      return cb?.({ ok: false, error: "Unknown action." });
    }

    // if only one left -> award
    if (onlyOneLeft(r)) {
      awardToLastPlayer(r);
      broadcastRoom(code);
      return cb?.({ ok: true });
    }

    // advance logic
    advanceIfNeeded(r);

    // if still in betting street, move to next actor
    if (g.street !== "showdown" && !streetBettingComplete(r)) {
      moveToNextActor(r);
    }

    broadcastRoom(code);
    cb?.({ ok: true });
  });

  socket.on("game:nextHand", (cb) => {
    const code = socket.data.roomCode;
    const r = getRoom(code);
    if (!r || !r.game?.started) return cb?.({ ok: false, error: "No game." });
    if (r.hostId !== socket.id) return cb?.({ ok: false, error: "Host only." });

    setupNewHand(r);
    broadcastRoom(code);
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    const code = socket.data.roomCode;
    const r = getRoom(code);
    if (!r) return;

    r.players = r.players.filter(p=>p.id!==socket.id);
    if (r.hostId === socket.id) r.hostId = r.players[0]?.id || null;
    if (r.players.length === 0) delete rooms[code];
    else broadcastRoom(code);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("Server running on port", PORT));
