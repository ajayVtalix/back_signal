const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
// const fetch = require("node-fetch");

const BACKEND_URL = 'https://vtalix.com'; // your API
const PORT = 3044;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// roomId -> Set(socketId)
const rooms = new Map();

// roomId -> callStartTimestamp
const activeCalls = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // ==============================
  // JOIN ROOM (SINGLE SOURCE)
  // ==============================
  socket.on("join-room", async ({ roomId, token }) => {
    try {
      const res = await fetch(
        `${BACKEND_URL}/appointments/${roomId}/can-join`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!res.ok) {
        socket.emit("join-denied");
        return;
      }

      const data = await res.json();
      if (!data.allowed) {
        socket.emit("join-denied");
        return;
      }

      // rest of your logic stays SAME ✅
    } catch (err) {
      console.error("Join error:", err);
      socket.emit("join-denied");
    }
  });

  // ==============================
  // WEBRTC SIGNALING
  // ==============================
  socket.on("offer", ({ offer, to }) => {
    io.to(to).emit("offer", { offer, from: socket.id });
  });

  socket.on("answer", ({ answer, to }) => {
    io.to(to).emit("answer", { answer, from: socket.id });
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    io.to(to).emit("ice-candidate", { candidate, from: socket.id });
  });

  // ==============================
  // CHAT
  // ==============================
  socket.on("chat-message", ({ message }) => {
    socket.to(socket.roomId).emit("chat-message", { message });
  });

  // ==============================
  // END CALL
  // ==============================
  socket.on("end-call", () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    io.to(roomId).emit("call-ended");
    activeCalls.delete(roomId);

    io.in(roomId).socketsLeave(roomId);
    rooms.delete(roomId);
  });

  // ==============================
  // DISCONNECT
  // ==============================
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

// 🚨 MUST USE server.listen
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Signaling server running on port ${PORT}`);
});
