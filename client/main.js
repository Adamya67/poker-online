const SERVER_URL = "https://poker-online-l5i4.onrender.com";

const statusEl = document.getElementById("status");
const roomCard = document.getElementById("roomCard");
const roomTitle = document.getElementById("roomTitle");
const hostTag = document.getElementById("hostTag");
const playersEl = document.getElementById("players");

const nameEl = document.getElementById("name");
const codeEl = document.getElementById("code");

const createBtn = document.getElementById("create");
const joinBtn = document.getElementById("join");
const leaveBtn = document.getElementById("leave");

let myId = null;

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
  showRoom(room);
});

function showRoom(room) {
  roomCard.style.display = "block";
  roomTitle.textContent = `Room: ${room.code}`;

  hostTag.textContent = room.hostId === myId ? "You are the host 👑" : "Host is another player";

  playersEl.innerHTML = "";
  room.players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.id === myId ? `${p.name} (You)` : p.name;
    playersEl.appendChild(li);
  });

  statusEl.textContent = "✅ In room. Share the code with friends.";
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
  socket.emit("room:leave", (res) => {
    roomCard.style.display = "none";
    statusEl.textContent = "Left room. Create or join another.";
    playersEl.innerHTML = "";
    codeEl.value = "";
  });
});
