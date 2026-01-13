const express=require("express");
const http=require("http");
const{Server}=require("socket.io");
const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*",methods:["GET","POST"]}});
io.on("connection",socket=>{
 console.log("Client connected:",socket.id);
 socket.on("join-room",({appointmentId,userId,userType})=>{
   if(!appointmentId)return;
   const roomId=String(appointmentId);
   socket.join(roomId);
   console.log(`${userType} ${userId} joined room ${roomId}`);
   socket.to(roomId).emit("peer-joined",{userId,userType});
   socket.emit("room-joined",{roomId});
 });
 socket.on("offer",({roomId,sdp})=>socket.to(roomId).emit("offer",{sdp}));
 socket.on("answer",({roomId,sdp})=>socket.to(roomId).emit("answer",{sdp}));
 socket.on("ice-candidate",({roomId,candidate})=>socket.to(roomId).emit("ice-candidate",{candidate}));
 socket.on("disconnect",()=>console.log("Client disconnected:",socket.id));
});
server.listen(3044,()=>console.log("🚀 Signaling server running on 3044"));