const SERVER_URL = "https://poker-online-l5i4.onrender.com";

const lobbyCard = document.getElementById("lobbyCard");
const tableWrap = document.getElementById("tableWrap");

const statusEl = document.getElementById("status");
const roomTitle = document.getElementById("roomTitle");
const hostTag = document.getElementById("hostTag");
const playersEl = document.getElementById("players");

const potEl = document.getElementById("pot");
const streetEl = document.getElementById("street");
const currentBetEl = document.getElementById("currentBet");
const toActEl = document.getElementById("toAct");

const communityEl = document.getElementById("community");
const myHandEl = document.getElementById("myHand");

const actionsEl = document.getElementById("actions");
const btnFold = document.getElementById("btnFold");
const btnCheck = document.getElementById("btnCheck");
const btnCall = document.getElementById("btnCall");
const btnRaise = document.getElementById("btnRaise");
const raiseToEl = document.getElementById("raiseTo");
const noteEl = document.getElementById("note");

const hostControls = document.getElementById("hostControls");
const startGameBtn = document.getElementById("startGame");
const nextHandBtn = document.getElementById("nextHand");

const nameEl = document.getElementById("name");
const codeEl = document.getElementById("code");
const createBtn = document.getElementById("create");
const joinBtn = document.getElementById("join");
const leaveBtn = document.getElementById("leave");

let myId = null;
let room = null;

const socket = io(SERVER_URL, { transports: ["websocket", "polling"] });

socket.on("connect", () => {
  myId = socket.id;
  statusEl.textContent = "✅ Connected. Create or join a room.";
});

socket.on("connect_error", (err) => {
  statusEl.textContent = "❌ Connect error: " + err.message;
});

socket.on("room:update", (r) => {
  room = r;
  render();
});

function cardToText(c) {
  const rank = c[0];
  const suit = c[1];
  const suitMap = { S:"♠", H:"♥", D:"♦", C:"♣" };
  return rank + (suitMap[suit] || suit);
}
function isRedSuit(c) { return c.endsWith("H") || c.endsWith("D"); }
function makeCardDiv(card) {
  const d = document.createElement("div");
  d.className = "cardUI" + (isRedSuit(card) ? " red" : "");
  d.textContent = cardToText(card);
  return d;
}

function me() {
  return room?.players?.find(p => p.id === myId) || null;
}

function playerNameBySeat(seat) {
  const p = room.players.find(x => x.seat === seat);
  return p ? p.name : "-";
}

function render() {
  if (!room) return;

  lobbyCard.style.display = "none";
  tableWrap.style.display = "block";

  roomTitle.textContent = `Room: ${room.code}`;
  const amHost = room.hostId === myId;
  hostTag.textContent = amHost ? "You are the host 👑" : "Host is another player";

  // info row
  potEl.textContent = room.game.pot;
  streetEl.textContent = room.game.street;
  currentBetEl.textContent = room.game.currentBet;
  toActEl.textContent = playerNameBySeat(room.game.toActSeat);

  // players list with stacks + dealer marker
  playersEl.innerHTML = "";
  room.players
    .slice()
    .sort((a,b)=>a.seat-b.seat)
    .forEach(p => {
      const li = document.createElement("li");
      const dealer = (p.seat === room.game.dealerSeat) ? " 🟡D" : "";
      const you = (p.id === myId) ? " (You)" : "";
      li.textContent = `${p.name}${you}${dealer} — ${p.stack}`;
      playersEl.appendChild(li);
    });

  // community
  communityEl.innerHTML = "";
  room.game.community.forEach(c => communityEl.appendChild(makeCardDiv(c)));

  // my hand
  myHandEl.innerHTML = "";
  if (room.game.started) {
    room.game.myHole.forEach(c => myHandEl.appendChild(makeCardDiv(c)));
  } else {
    myHandEl.textContent = "(Start game to get cards)";
  }

  // host controls
  hostControls.style.display = amHost ? "flex" : "none";
  startGameBtn.style.display = room.game.started ? "none" : "inline-block";
  nextHandBtn.style.display = room.game.started ? "inline-block" : "none";

  // actions: only show if game started and it's your turn and you're still in
  const my = me();
  const myTurn = my && room.game.toActSeat === my.seat && room.game.street !== "showdown";
  actionsEl.style.display = myTurn ? "flex" : "none";

  // set a default raiseTo suggestion
  if (myTurn) {
    const suggested = room.game.currentBet + 20;
    raiseToEl.value = String(suggested);
    noteEl.textContent = "Your turn.";
  } else if (room.game.street === "showdown") {
    noteEl.textContent = "Showdown! Host can click Next Hand.";
  } else {
    noteEl.textContent = "";
  }
}

function act(type, raiseTo) {
  socket.emit("game:action", { type, raiseTo }, (res) => {
    if (!res?.ok) alert(res?.error || "Action failed");
  });
}

btnFold.addEventListener("click", () => act("fold"));
btnCheck.addEventListener("click", () => act("check"));
btnCall.addEventListener("click", () => act("call"));
btnRaise.addEventListener("click", () => act("raise", Number(raiseToEl.value)));

createBtn.addEventListener("click", () => {
  const name = (nameEl.value || "Player").trim();
  socket.emit("room:create", { name }, (res) => {
    if (!res?.ok) statusEl.textContent = "❌ " + (res?.error || "Create failed");
  });
});

joinBtn.addEventListener("click", () => {
  const name = (nameEl.value || "Player").trim();
  const code = (codeEl.value || "").trim().toUpperCase();
  if (!code) return (statusEl.textContent = "⚠️ Enter a room code.");
  socket.emit("room:join", { code, name }, (res) => {
    if (!res?.ok) statusEl.textContent = "❌ " + (res?.error || "Join failed");
  });
});

leaveBtn.addEventListener("click", () => {
  socket.emit("room:leave", () => {
    room = null;
    tableWrap.style.display = "none";
    lobbyCard.style.display = "block";
    statusEl.textContent = "Left room.";
    codeEl.value = "";
  });
});

startGameBtn.addEventListener("click", () => {
  socket.emit("game:start", (res) => {
    if (!res?.ok) alert(res?.error || "Could not start game");
  });
});

nextHandBtn.addEventListener("click", () => {
  socket.emit("game:nextHand", (res) => {
    if (!res?.ok) alert(res?.error || "Could not start next hand");
  });
});
