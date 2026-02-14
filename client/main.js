const SERVER_URL = "https://poker-online-l5i4.onrender.com";

const lobbyCard = document.getElementById("lobbyCard");
const tableWrap = document.getElementById("tableWrap");

const statusEl = document.getElementById("status");
const roomTitle = document.getElementById("roomTitle");
const hostTag = document.getElementById("hostTag");
const playersEl = document.getElementById("players");
const communityEl = document.getElementById("community");
const myHandEl = document.getElementById("myHand");

const hostControls = document.getElementById("hostControls");
const startGameBtn = document.getElementById("startGame");
const dealCommunityBtn = document.getElementById("dealCommunity");

const nameEl = document.getElementById("name");
const codeEl = document.getElementById("code");
const createBtn = document.getElementById("create");
const joinBtn = document.getElementById("join");
const leaveBtn = document.getElementById("leave");

let myId = null;
let currentRoom = null;

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"]
});

socket.on("connect", () => {
  myId = socket.id;
  statusEl.textContent = "✅ Connected. Create or join a room.";
});

socket.on("connect_error", (err) => {
  statusEl.textContent = "❌ Connect error: " + err.message;
});

socket.on("room:update", (room) => {
  currentRoom = room;
  showRoom(room);
});

function cardToText(c) {
  // "AS" -> A♠
  const rank = c[0];
  const suit = c[1];
  const suitMap = { S:"♠", H:"♥", D:"♦", C:"♣" };
  return rank + (suitMap[suit] || suit);
}

function isRedSuit(c) {
  return c.endsWith("H") || c.endsWith("D");
}

function makeCardDiv(card) {
  const d = document.createElement("div");
  d.className = "cardUI" + (isRedSuit(card) ? " red" : "");
  d.textContent = cardToText(card);
  return d;
}

function showRoom(room) {
  lobbyCard.style.display = "none";
  tableWrap.style.display = "block";

  roomTitle.textContent = `Room: ${room.code}`;
  const amHost = room.hostId === myId;
  hostTag.textContent = amHost ? "You are the host 👑" : "Waiting for host…";

  // players
  playersEl.innerHTML = "";
  room.players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.id === myId ? `${p.name} (You)` : p.name;
    playersEl.appendChild(li);
  });

  // host controls
  hostControls.style.display = amHost ? "flex" : "none";

  // community cards
  communityEl.innerHTML = "";
  room.game.community.forEach(c => communityEl.appendChild(makeCardDiv(c)));

  // my hole cards
  myHandEl.innerHTML = "";
  if (room.game.started) {
    room.game.myHole.forEach(c => myHandEl.appendChild(makeCardDiv(c)));
  } else {
    myHandEl.textContent = "(Start the game to get cards)";
  }
}

createBtn.addEventListener("click", () => {
  const name = (nameEl.value || "Player").trim();
  socket.emit("room:create", { name }, (res) => {
    if (!res?.ok) statusEl.textContent = "❌ " + (res?.error || "Create failed");
  });
});

joinBtn.addEventListener("click", () => {
  const name = (nameEl.value || "Player").trim();
  const code = (codeEl.value || "").trim().toUpperCase();
  if (!code) {
    statusEl.textContent = "⚠️ Enter a room code.";
    return;
  }
  socket.emit("room:join", { code, name }, (res) => {
    if (!res?.ok) statusEl.textContent = "❌ " + (res?.error || "Join failed");
  });
});

leaveBtn.addEventListener("click", () => {
  socket.emit("room:leave", () => {
    currentRoom = null;
    tableWrap.style.display = "none";
    lobbyCard.style.display = "block";
    statusEl.textContent = "Left room. Create or join another.";
    playersEl.innerHTML = "";
    communityEl.innerHTML = "";
    myHandEl.innerHTML = "";
    codeEl.value = "";
  });
});

startGameBtn.addEventListener("click", () => {
  socket.emit("game:start", (res) => {
    if (!res?.ok) alert(res?.error || "Could not start game");
  });
});

dealCommunityBtn.addEventListener("click", () => {
  socket.emit("game:dealCommunity", (res) => {
    if (!res?.ok) alert(res?.error || "Could not deal");
  });
});
