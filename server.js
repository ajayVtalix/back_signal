const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const SERVER_VERSION = "signal-debug-2026-04-01-v2";

app.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "back_signal",
    version: SERVER_VERSION,
    rooms: rooms.size,
  });
});

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      participants: new Map(),
      chatHistory: [],
    });
  }

  return rooms.get(roomId);
}

function serializeParticipant(participant) {
  return {
    socketId: participant.socketId,
    participantId: participant.participantId,
    role: participant.role || "guest",
    displayName: participant.displayName || "Guest",
    joinedAt: participant.joinedAt,
  };
}

function getRoomParticipants(room) {
  return Array.from(room.participants.values()).map(serializeParticipant);
}

function destroyRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.participants.size > 0) {
    return;
  }

  rooms.delete(roomId);
}

function leaveCurrentRoom(socket, { notify = true } = {}) {
  const roomId = socket.data.roomId;
  const participantId = socket.data.participantId;

  if (!roomId || !participantId) {
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    socket.data.roomId = null;
    socket.data.participantId = null;
    return;
  }

  const participant = room.participants.get(participantId);
  if (participant?.socketId === socket.id) {
    room.participants.delete(participantId);

    if (notify) {
      socket.to(roomId).emit("peer-left", {
        roomId,
        participantId,
        socketId: socket.id,
      });
    }
  }

  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.participantId = null;
  destroyRoomIfEmpty(roomId);
}

io.on("connection", (socket) => {
  console.log("[signal] connection", {
    socketId: socket.id,
    version: SERVER_VERSION,
  });

  socket.onAny((eventName, payload) => {
    if (eventName === "ice-candidate") {
      console.log("[signal] event", {
        socketId: socket.id,
        eventName,
        roomId: socket.data.roomId || payload?.roomId || null,
        hasCandidate: Boolean(payload?.candidate),
        to: payload?.to || null,
      });
      return;
    }

    console.log("[signal] event", {
      socketId: socket.id,
      eventName,
      roomId: socket.data.roomId || payload?.roomId || null,
      to: payload?.to || null,
    });
  });

  socket.on("join-room", (payload) => {
    const roomId =
      typeof payload === "string" ? payload : String(payload?.roomId || "");
    const participantId =
      typeof payload === "string"
        ? socket.id
        : String(payload?.participantId || socket.id);
    const role =
      typeof payload === "string" ? "guest" : payload?.role || "guest";
    const displayName =
      typeof payload === "string" ? "Guest" : payload?.displayName || "Guest";

    if (!roomId) {
      socket.emit("error-message", { message: "roomId is required" });
      return;
    }

    console.log("[signal] join-room", {
      socketId: socket.id,
      roomId,
      participantId,
      role,
      displayName,
    });

    leaveCurrentRoom(socket, { notify: false });

    const room = getRoom(roomId);
    const existingParticipant = room.participants.get(participantId);

    if (!existingParticipant && room.participants.size >= 2) {
      socket.emit("room-full", { roomId });
      return;
    }

    if (existingParticipant?.socketId && existingParticipant.socketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(existingParticipant.socketId);
      if (previousSocket) {
        previousSocket.emit("session-replaced", { roomId, participantId });
        previousSocket.leave(roomId);
      }
    }

    const participant = {
      socketId: socket.id,
      participantId,
      role,
      displayName,
      joinedAt: new Date().toISOString(),
    };

    room.participants.set(participantId, participant);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.participantId = participantId;

    const participants = getRoomParticipants(room);
    socket.emit("joined-room", {
      roomId,
      participantId,
      participants,
    });
    console.log("[signal] joined-room", {
      socketId: socket.id,
      roomId,
      participantId,
      participantsCount: participants.length,
    });
    socket.emit("chat-history", room.chatHistory);

    const peers = participants.filter((entry) => entry.participantId !== participantId);

    if (peers.length === 0) {
      console.log("[signal] waiting", { roomId, participantId });
      socket.emit("waiting", { roomId });
      return;
    }

    const peer = peers[0];
    socket.emit("ready", {
      roomId,
      peerId: peer.socketId,
      participantId: peer.participantId,
      shouldCreateOffer: true,
    });
    console.log("[signal] ready", {
      roomId,
      participantId,
      peerSocketId: peer.socketId,
      peerParticipantId: peer.participantId,
    });

    socket.to(roomId).emit("participant-joined", {
      roomId,
      participant: serializeParticipant(participant),
    });
  });

  socket.on("offer", ({ offer, to }) => {
    if (!to) return;

    console.log("[signal] offer", {
      fromSocketId: socket.id,
      toSocketId: to,
      roomId: socket.data.roomId,
    });

    io.to(to).emit("offer", {
      offer,
      from: socket.id,
      roomId: socket.data.roomId,
      participantId: socket.data.participantId,
    });
  });

  socket.on("answer", ({ answer, to }) => {
    if (!to) return;

    console.log("[signal] answer", {
      fromSocketId: socket.id,
      toSocketId: to,
      roomId: socket.data.roomId,
    });

    io.to(to).emit("answer", {
      answer,
      from: socket.id,
      roomId: socket.data.roomId,
      participantId: socket.data.participantId,
    });
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    if (!to || !candidate) return;

    console.log("[signal] ice-candidate", {
      fromSocketId: socket.id,
      toSocketId: to,
      roomId: socket.data.roomId,
    });

    io.to(to).emit("ice-candidate", {
      candidate,
      from: socket.id,
      roomId: socket.data.roomId,
      participantId: socket.data.participantId,
    });
  });

  socket.on("chat-message", ({ roomId, message, meta = {} }) => {
    const activeRoomId = socket.data.roomId;
    const targetRoomId = roomId || activeRoomId;

    if (!targetRoomId || activeRoomId !== targetRoomId || !String(message || "").trim()) {
      return;
    }

    const room = rooms.get(targetRoomId);
    if (!room) {
      return;
    }

    const chatPayload = {
      roomId: targetRoomId,
      message: String(message).trim(),
      meta,
      from: socket.data.participantId,
      timestamp: new Date().toISOString(),
    };

    room.chatHistory.push(chatPayload);
    if (room.chatHistory.length > 100) {
      room.chatHistory.shift();
    }

    io.to(targetRoomId).emit("chat-message", chatPayload);
  });

  socket.on("leave-room", () => {
    leaveCurrentRoom(socket);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
    console.log("[signal] disconnect", {
      socketId: socket.id,
      roomId: socket.data.roomId || null,
    });
  });
});

const PORT = 3044;

server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on ${PORT}`);
  console.log(`[signal] version ${SERVER_VERSION}`);
});
