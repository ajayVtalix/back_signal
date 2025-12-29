const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = 3044;
const BACKEND_URL = "https://vtalix.com";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = new Map();
const activeCalls = new Map();

io.on("connection", (socket) => {
  socket.on("join-room", async ({ roomId, token }) => {
    try {
      const res = await fetch(
        `${BACKEND_URL}/appointments/${roomId}/can-join`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await res.json();
      if (!data.allowed) return socket.emit("join-denied");

      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);

      if (room.size >= 2) return socket.emit("room-full");

      room.add(socket.id);
      socket.join(roomId);
      socket.roomId = roomId;
      socket.role = data.role;

      if (!activeCalls.has(roomId)) {
        activeCalls.set(roomId, Date.now());
      }

      socket.emit("call-start-time", {
        startTime: activeCalls.get(roomId)
      });

      if (room.size === 2) {
        const [a, b] = [...room];
        io.to(a).emit("ready", b);
        io.to(b).emit("ready", a);
      } else {
        socket.emit("waiting");
      }
    } catch (e) {
      console.error("Join error:", e);
      socket.emit("join-denied");
    }
  });

  socket.on("offer", ({ offer, to }) =>
    io.to(to).emit("offer", { offer, from: socket.id })
  );

  socket.on("answer", ({ answer, to }) =>
    io.to(to).emit("answer", { answer, from: socket.id })
  );

  socket.on("ice-candidate", ({ candidate, to }) =>
    io.to(to).emit("ice-candidate", { candidate, from: socket.id })
  );

  socket.on("chat-message", ({ roomId, message }) => {
    socket.to(roomId).emit("chat-message", { message });
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.delete(socket.id);
    socket.to(roomId).emit("peer-left");

    if (room.size === 0) {
      rooms.delete(roomId);
      activeCalls.delete(roomId);
    }
  });
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Signaling server running on ${PORT}`)
);
