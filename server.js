const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

function generateSecureId(prefix = "", length = 12) {
  return (
    prefix +
    crypto.randomBytes(Math.ceil(length / 2))
      .toString("hex")
      .slice(0, length)
  );
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Simple HTTP route to inspect room state (read-only)
app.get('/room/:roomId', (req, res) => {
  const rid = req.params.roomId;
  const room = rooms.get(rid) || [];
  const participants = room.map(p => ({ customId: p.customId, role: p.role, userId: p.userId }));
  res.json({ roomId: rid, participants });
});

// Map: roomId -> [{ customId, socketId, role, userId }]
const rooms = new Map();
// Map: appointmentId -> roomId
const appointmentRooms = new Map();
// Map: customId -> socketId
const customToSocket = new Map();
// Map: socketId -> customId
const socketToCustom = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Generate a custom session socket key for DB storage
  socket.customSocketId = generateSecureId("soc_", 14);
  customToSocket.set(socket.customSocketId, socket.id);
  socketToCustom.set(socket.id, socket.customSocketId);

  // Optional: accept auth token from handshake or later via 'auth' event
  if (socket.handshake && socket.handshake.auth && socket.handshake.auth.token) {
    socket.token = socket.handshake.auth.token;
    console.log('socket provided token via handshake');
  }

  socket.on('auth', ({ token }) => {
    socket.token = token;
  });

  // ─────────────────────────────────────────────────────────────
  // JOIN ROOM EVENT
  // Receive: appointmentId, doctorId, patientId
  // ─────────────────────────────────────────────────────────────
  socket.on("join-room", ({ appointmentId, roomId: providedRoomId, role, userId }) => {
    // Accept either appointmentId or explicit roomId
    if (!appointmentId && !providedRoomId) {
      socket.emit("join-error", { success: false, message: "Invalid join-room payload" });
      return;
    }

    // Resolve roomId
    let roomId = providedRoomId;
    if (!roomId && appointmentId) {
      if (!appointmentRooms.has(appointmentId)) {
        roomId = generateSecureId("room_", 12);
        appointmentRooms.set(appointmentId, roomId);
      } else {
        roomId = appointmentRooms.get(appointmentId);
      }
    }

    // Ensure room entry exists
    if (!rooms.has(roomId)) rooms.set(roomId, []);

    // Clean stale entries by checking actual connected sockets
    const raw = rooms.get(roomId) || [];
    const clean = raw.filter(e => io.sockets.sockets.has(e.socketId));
    rooms.set(roomId, clean);

    const room = rooms.get(roomId);

    // Limit two participants
    if (room.length >= 2) {
      socket.emit("room-full", { success: false, message: "Room is already full" });
      return;
    }

    // Add new participant
    const entry = { customId: socket.customSocketId, socketId: socket.id, role: role || null, userId: userId || null };
    room.push(entry);
    rooms.set(roomId, room);

    socket.join(roomId);
    socket.roomId = roomId;

    // Notify the joining socket with current peer list
    const peers = room.filter(e => e.customId !== socket.customSocketId).map(e => ({ customId: e.customId, role: e.role, userId: e.userId }));

    socket.emit("joined-room", {
      success: true,
      roomId,
      socketId: socket.customSocketId,
      peers,
      message: peers.length === 0 ? "Waiting for other participant" : "Peer present"
    });

    // Notify existing peers that a new peer joined
    socket.to(roomId).emit("peer-joined", { customId: socket.customSocketId, role: entry.role, userId: entry.userId });
  });

  // ─────────────────────────────────────────────────────────────
  // OFFER / ANSWER / ICE EXCHANGE
  // ─────────────────────────────────────────────────────────────
  // Targeted signalling using customIds
  socket.on("offer", ({ offer, to }) => {
    const targetSocketId = customToSocket.get(to);
    if (targetSocketId && io.sockets.sockets.has(targetSocketId)) {
      io.to(targetSocketId).emit("offer", { offer, from: socket.customSocketId });
    }
  });

  socket.on("answer", ({ answer, to }) => {
    const targetSocketId = customToSocket.get(to);
    if (targetSocketId && io.sockets.sockets.has(targetSocketId)) {
      io.to(targetSocketId).emit("answer", { answer, from: socket.customSocketId });
    }
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    const targetSocketId = customToSocket.get(to);
    if (targetSocketId && io.sockets.sockets.has(targetSocketId)) {
      io.to(targetSocketId).emit("ice-candidate", { candidate, from: socket.customSocketId });
    }
  });

  // Chat messaging
  socket.on("chat-message", ({ roomId, message, meta }) => {
    if (!roomId || !message) return;
    const payload = { from: socket.customSocketId, message, meta: meta || {}, timestamp: Date.now() };
    io.to(roomId).emit("chat-message", payload);
    // TODO: persist chat to DB via REST call if required
  });

  // ─────────────────────────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    const customId = socketToCustom.get(socket.id);
    customToSocket.delete(customId);
    socketToCustom.delete(socket.id);

    if (!roomId) return;

    let room = rooms.get(roomId) || [];
    room = room.filter(e => e.socketId !== socket.id);
    if (room.length === 0) {
      rooms.delete(roomId);
      // also delete appointment mapping if any
      for (const [appt, rid] of appointmentRooms.entries()) {
        if (rid === roomId) appointmentRooms.delete(appt);
      }
    } else {
      rooms.set(roomId, room);
    }

    socket.to(roomId).emit("peer-left", { success: true, message: "Participant disconnected", customId });
  });
});

const PORT = 3044;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
