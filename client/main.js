const socket = io("https://poker-online-l5i4.onrender.com");

socket.on("connect", () => {
  console.log("Connected! My id:", socket.id);
});
socket.on("connect_error", (err) => {
  console.log("Connect error:", err.message);
});

