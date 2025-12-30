const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// IMPORTANT: socket.io must be attached to SAME server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Room storage: roomId -> [socketId, socketId]
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (roomId) => {
    if (!rooms.has(roomId)) rooms.set(roomId, []);
    const room = rooms.get(roomId);

    if (room.length >= 2) {
      socket.emit("room-full");
      return;
    }

    room.push(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;

    if (room.length === 2) {
      // tell second user to create offer
      socket.emit("ready", room[0]);
    } else {
      socket.emit("waiting");
    }
  });

  socket.on("offer", ({ offer, to }) => {
    io.to(to).emit("offer", {
      offer,
      from: socket.id
    });
  });

  socket.on("answer", ({ answer, to }) => {
    io.to(to).emit("answer", {
      answer,
      from: socket.id
    });
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    io.to(to).emit("ice-candidate", {
      candidate,
      from: socket.id
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId) || [];
    rooms.set(roomId, room.filter(id => id !== socket.id));
    socket.to(roomId).emit("peer-left");

    if (rooms.get(roomId).length === 0) {
      rooms.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3044;

server.listen(PORT, (req, res) => {
  console.log(`Signaling server are running....... port ${process.env.PORT}`)
});