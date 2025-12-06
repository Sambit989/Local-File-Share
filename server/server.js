const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const os = require('os');
const QRCode = require('qrcode');
const { publicIpv4 } = require('public-ip');
const ngrok = require('ngrok');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, '../client')));

// Store rooms and clients
const rooms = new Map(); // roomCode -> { clients: Map, host: clientId }

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Generate unique room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomCode = url.searchParams.get('room') || generateRoomCode();

  // Initialize room if it doesn't exist
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, { clients: new Map(), host: null });
  }

  const room = rooms.get(roomCode);
  const clientId = generateId();
  room.clients.set(clientId, { ws, id: clientId, roomCode });

  // Set host if this is the first client
  if (!room.host) {
    room.host = clientId;
  }

  console.log(`Client connected: ${clientId} in room: ${roomCode}`);

  // Send the client their info
  ws.send(JSON.stringify({
    type: 'init',
    clientId: clientId,
    roomCode: roomCode,
    isHost: clientId === room.host,
    totalClients: room.clients.size
  }));

  // Broadcast updated client list to room
  broadcastRoomList(roomCode);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(clientId, roomCode, data);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    room.clients.delete(clientId);
    console.log(`Client disconnected: ${clientId} from room: ${roomCode}`);

    // If host left, assign new host or remove room
    if (clientId === room.host) {
      if (room.clients.size > 0) {
        room.host = Array.from(room.clients.keys())[0];
        // Notify new host
        const newHost = room.clients.get(room.host);
        if (newHost) {
          newHost.ws.send(JSON.stringify({ type: 'became-host' }));
        }
      } else {
        rooms.delete(roomCode);
      }
    }

    broadcastRoomList(roomCode);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Handle different message types
function handleMessage(senderId, roomCode, data) {
  const room = rooms.get(roomCode);
  if (!room) return;

  switch (data.type) {
    case 'webrtc-offer':
      // Forward WebRTC offer to target client
      forwardToClient(room, data.targetId, {
        type: 'webrtc-offer',
        senderId: senderId,
        offer: data.offer
      });
      break;

    case 'webrtc-answer':
      // Forward WebRTC answer to target client
      forwardToClient(room, data.targetId, {
        type: 'webrtc-answer',
        senderId: senderId,
        answer: data.answer
      });
      break;

    case 'webrtc-ice-candidate':
      // Forward ICE candidate to target client
      forwardToClient(room, data.targetId, {
        type: 'webrtc-ice-candidate',
        senderId: senderId,
        candidate: data.candidate
      });
      break;

    case 'signal':
      // Legacy signaling - keep for backward compatibility
      forwardToClient(room, data.targetId, {
        type: 'signal',
        senderId: senderId,
        signal: data.signal
      });
      break;

    case 'file-offer':
      // Forward file offer to target client
      forwardToClient(room, data.targetId, {
        type: 'file-offer',
        senderId: senderId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        fileType: data.fileType
      });
      break;

    case 'file-accept':
      // Forward acceptance to sender
      forwardToClient(room, data.targetId, {
        type: 'file-accept',
        senderId: senderId
      });
      break;

    case 'file-reject':
      // Forward rejection to sender
      forwardToClient(room, data.targetId, {
        type: 'file-reject',
        senderId: senderId
      });
      break;

    case 'file-chunk':
      // Forward file chunk to target client
      forwardToClient(room, data.targetId, {
        type: 'file-chunk',
        senderId: senderId,
        chunk: data.chunk,
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks
      });
      break;

    case 'file-complete':
      // Notify target that file transfer is complete
      forwardToClient(room, data.targetId, {
        type: 'file-complete',
        senderId: senderId
      });
      break;
  }
}

// Forward message to specific client in room
function forwardToClient(room, targetId, message) {
  const client = room.clients.get(targetId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

// Broadcast client list to all clients in room
function broadcastRoomList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const clientList = Array.from(room.clients.keys());
  const message = JSON.stringify({
    type: 'client-list',
    clients: clientList,
    host: room.host
  });

  room.clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

// Generate random client ID
function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/:roomCode', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    clients: Array.from(rooms.values()).reduce((sum, room) => sum + room.clients.size, 0),
    uptime: process.uptime()
  });
});

// Get public URL and QR code for current room
app.get('/qrcode/:roomCode?', async (req, res) => {
  try {
    let baseUrl;
    let isOnline = false;

    // For cloud hosting (Render, etc.), use the request host
    if (req.headers.host && (req.headers.host.includes('render.com') || req.headers.host.includes('onrender.com') || req.protocol === 'https')) {
      const protocol = req.protocol;
      const host = req.headers.host;
      baseUrl = `${protocol}://${host}`;
      isOnline = true;
      console.log('✅ Cloud hosting detected, using:', baseUrl);
    } else {
      // Try ngrok first for public URL
      try {
        baseUrl = await ngrok.connect({
          addr: process.env.PORT || 3000,
          authtoken: process.env.NGROK_AUTH_TOKEN // Optional: set in environment
        });
        console.log('✅ Ngrok URL:', baseUrl);
        isOnline = true;
      } catch (ngrokError) {
        console.log('⚠️ Ngrok not available:', ngrokError.message);
        console.log('💡 For online access:');
        console.log('   1. Get free ngrok account at https://ngrok.com');
        console.log('   2. Set NGROK_AUTH_TOKEN environment variable');
        console.log('   3. Restart the server');

        // Fallback to local IP
        const localIP = getLocalIP();
        const port = process.env.PORT || 3000;
        baseUrl = `http://${localIP}:${port}`;
        console.log('📍 Using local network URL:', baseUrl);
      }
    }

    const roomCode = req.params.roomCode || req.query.room;
    const fullUrl = roomCode ? `${baseUrl}/${roomCode}` : baseUrl;

    // Generate QR code as data URL
    const qrCodeDataURL = await QRCode.toDataURL(fullUrl);

    res.json({
      url: fullUrl,
      qrCode: qrCodeDataURL,
      roomCode: roomCode,
      isOnline: isOnline
    });
  } catch (error) {
    console.error('❌ Error generating QR code:', error);
    res.status(500).json({
      error: 'Failed to generate QR code',
      details: error.message,
      fallback: 'Using local network mode'
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n=================================');
  console.log('🚀 File Share Server Running!');
  console.log('=================================');
  console.log(`\n📱 Open on this device:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`\n📱 Open on other devices (same WiFi):`);
  console.log(`   http://${localIP}:${PORT}`);
  console.log(`\n🌐 Online access (with ngrok):`);
  console.log(`   Set NGROK_AUTH_TOKEN and restart`);
  console.log('\n=================================\n');
});
