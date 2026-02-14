const status = document.createElement("div");
status.style.marginTop = "16px";
status.style.fontSize = "18px";
status.textContent = "Connecting to server...";
document.body.appendChild(status);

// connect to your Render server
const socket = io("https://poker-online-l5i4.onrender.com", {
  transports: ["websocket", "polling"]
});

socket.on("connect", () => {
  console.log("Connected! id:", socket.id);
  status.textContent = "✅ Connected! Waiting for players...";
});

socket.on("disconnect", () => {
  status.textContent = "❌ Disconnected";
});

socket.on("connect_error", (err) => {
  console.log("Connect error:", err.message);
  status.textContent = "❌ Connect error: " + err.message;
});
