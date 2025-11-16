const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const os = require('os');
const QRCode = require('qrcode');
const { publicIpv4 } = require('public-ip');
const ngrok = require('@ngrok/ngrok');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, '../client')));

// Store connected clients
const clients = new Map();

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

// WebSocket connection handler
wss.on('connection', (ws) => {
  const clientId = generateId();
  clients.set(clientId, { ws, id: clientId });

  console.log(`Client connected: ${clientId}`);

  // Send the client their ID
  ws.send(JSON.stringify({
    type: 'init',
    clientId: clientId,
    totalClients: clients.size
  }));

  // Broadcast updated client list to all
  broadcastClientList();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(clientId, data);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}`);
    broadcastClientList();
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Handle different message types
function handleMessage(senderId, data) {
  switch (data.type) {
    case 'signal':
      // Forward signaling data for WebRTC
      forwardToClient(data.targetId, {
        type: 'signal',
        senderId: senderId,
        signal: data.signal
      });
      break;

    case 'file-offer':
      // Forward file offer to target client
      forwardToClient(data.targetId, {
        type: 'file-offer',
        senderId: senderId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        fileType: data.fileType
      });
      break;

    case 'file-accept':
      // Forward acceptance to sender
      forwardToClient(data.targetId, {
        type: 'file-accept',
        senderId: senderId
      });
      break;

    case 'file-reject':
      // Forward rejection to sender
      forwardToClient(data.targetId, {
        type: 'file-reject',
        senderId: senderId
      });
      break;

    case 'file-chunk':
      // Forward file chunk to target client
      forwardToClient(data.targetId, {
        type: 'file-chunk',
        senderId: senderId,
        chunk: data.chunk,
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks
      });
      break;

    case 'file-complete':
      // Notify target that file transfer is complete
      forwardToClient(data.targetId, {
        type: 'file-complete',
        senderId: senderId
      });
      break;
  }
}

// Forward message to specific client
function forwardToClient(targetId, message) {
  const client = clients.get(targetId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

// Broadcast client list to all connected clients
function broadcastClientList() {
  const clientList = Array.from(clients.keys());
  const message = JSON.stringify({
    type: 'client-list',
    clients: clientList
  });

  clients.forEach((client) => {
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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    clients: clients.size,
    uptime: process.uptime()
  });
});

// Get public URL and QR code
app.get('/qrcode', async (req, res) => {
  try {
    // Try ngrok first for public URL
    let publicUrl;
    try {
      const listener = await ngrok.forward({
        addr: process.env.PORT || 3000,
        authtoken: process.env.NGROK_AUTH_TOKEN // Optional: set in environment
      });
      publicUrl = listener.url();
      console.log('Ngrok URL:', publicUrl);
    } catch (ngrokError) {
      console.log('Ngrok failed, using public IP:', ngrokError.message);
      const publicIP = await publicIpv4();
      const port = process.env.PORT || 3000;
      publicUrl = `http://${publicIP}:${port}`;
    }

    // Generate QR code as data URL
    const qrCodeDataURL = await QRCode.toDataURL(publicUrl);

    res.json({
      url: publicUrl,
      qrCode: qrCodeDataURL
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
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
  console.log('\n=================================\n');
});
