let ws = null;
let myId = null;
let selectedFile = null;
let currentTransfer = null;
let receivedChunks = [];

// Load QR code and public URL
async function loadQRCode() {
  try {
    const response = await fetch('/qrcode');
    const data = await response.json();

    if (data.url && data.qrCode) {
      document.getElementById('publicUrl').textContent = data.url;

      const qrContainer = document.getElementById('qrCodeContainer');
      qrContainer.innerHTML = `<img src="${data.qrCode}" alt="QR Code" style="width: 150px; height: 150px; border: 2px solid #ddd; border-radius: 8px;">`;

      document.getElementById('qrCodeSection').style.display = 'block';
      console.log('✅ QR code loaded:', data.url);
    }
  } catch (error) {
    console.error('❌ Failed to load QR code:', error);
    // Fallback: show local URL
    const localUrl = `${window.location.protocol}//${window.location.host}`;
    document.getElementById('publicUrl').textContent = `Local: ${localUrl}`;
    document.getElementById('qrCodeSection').style.display = 'block';
  }
}

// Initialize WebSocket connection
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  console.log('🔌 Connecting to:', wsUrl);
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('✅ Connected to server');
    updateStatus('connected', 'Connected');
    updateDebugInfo('WebSocket: Connected');
  };
  
  ws.onmessage = (event) => {
    console.log('📨 Received message:', event.data);
    try {
      const data = JSON.parse(event.data);
      console.log('📦 Parsed data:', data);
      handleMessage(data);
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  };
  
  ws.onclose = () => {
    console.log('❌ Disconnected from server');
    updateStatus('error', 'Disconnected');
    updateDebugInfo('WebSocket: Disconnected - Reconnecting...');
    setTimeout(initWebSocket, 3000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateStatus('error', 'Connection Error');
    updateDebugInfo('WebSocket: Error occurred');
  };
}

// Handle incoming messages
function handleMessage(data) {
  console.log('🔄 Handling message type:', data.type);
  
  switch (data.type) {
    case 'init':
      myId = data.clientId;
      document.getElementById('deviceId').textContent = myId;
      console.log('🆔 My ID:', myId);
      updateDebugInfo(`My ID: ${myId}`);
      break;
      
    case 'client-list':
      console.log('👥 Client list updated:', data.clients);
      updateDevicesList(data.clients);
      break;
      
    case 'file-offer':
      console.log('📨 FILE OFFER RECEIVED!', data);
      handleFileOffer(data);
      break;
      
    case 'file-accept':
      console.log('✅ File accepted by:', data.senderId);
      handleFileAccept(data);
      break;
      
    case 'file-reject':
      console.log('❌ File rejected by:', data.senderId);
      handleFileReject(data);
      break;
      
    case 'file-chunk':
      console.log('📦 Chunk received:', data.chunkIndex, '/', data.totalChunks);
      handleFileChunk(data);
      break;
      
    case 'file-complete':
      console.log('✅ File transfer complete from:', data.senderId);
      handleFileComplete(data);
      break;
      
    default:
      console.log('⚠️ Unknown message type:', data.type);
  }
}

// Update status badge
function updateStatus(type, text) {
  const badge = document.getElementById('statusBadge');
  badge.textContent = text;
  badge.className = 'status-badge ' + type;
}

// Update devices list
function updateDevicesList(clients) {
  const devicesList = document.getElementById('devicesList');
  const deviceCount = document.getElementById('deviceCount');
  
  const otherClients = clients.filter(id => id !== myId);
  deviceCount.textContent = `${otherClients.length} online`;
  
  console.log('📱 Other devices:', otherClients);
  
  if (otherClients.length === 0) {
    devicesList.innerHTML = `
      <div class="empty-state">
        <p>No other devices connected</p>
        <small>Open this app on another device</small>
      </div>
    `;
    return;
  }
  
  devicesList.innerHTML = otherClients.map(id => `
    <div class="device-item">
      <div class="device-info">
        <span class="device-icon">📱</span>
        <span class="device-id-text">${id}</span>
      </div>
      <button class="btn btn-send" onclick="sendFileTo('${id}')" ${!selectedFile ? 'disabled' : ''}>
        Send File
      </button>
    </div>
  `).join('');
}

// Copy ID to clipboard
function copyId() {
  navigator.clipboard.writeText(myId);
  const btn = document.getElementById('copyBtn');
  btn.textContent = '✓ Copied!';
  console.log('📋 ID copied to clipboard');
  setTimeout(() => {
    btn.textContent = '📋 Copy';
  }, 2000);
}

// Handle file selection
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) {
    selectedFile = file;
    document.getElementById('fileLabel').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    
    console.log('📁 File selected:', file.name, formatFileSize(file.size));
    
    // Update send buttons
    const sendButtons = document.querySelectorAll('.btn-send');
    sendButtons.forEach(btn => btn.disabled = false);
  }
}

// Send file to specific device
async function sendFileTo(targetId) {
  if (!selectedFile) {
    alert('Please select a file first');
    return;
  }
  
  console.log('📤 Sending file to:', targetId);
  console.log('📄 File details:', {
    name: selectedFile.name,
    size: selectedFile.size,
    type: selectedFile.type
  });
  
  currentTransfer = {
    targetId: targetId,
    file: selectedFile,
    startTime: Date.now()
  };
  
  const message = {
    type: 'file-offer',
    targetId: targetId,
    fileName: selectedFile.name,
    fileSize: selectedFile.size,
    fileType: selectedFile.type
  };
  
  console.log('📨 Sending message:', message);
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    console.log('✅ Message sent successfully');
    showTransferProgress('Waiting for acceptance...', targetId, 0);
  } else {
    console.error('❌ WebSocket not ready. State:', ws.readyState);
    alert('Connection not ready. Please wait and try again.');
  }
}

// Handle file offer
function handleFileOffer(data) {
  console.log('🎯 Processing file offer from:', data.senderId);
  
  currentTransfer = {
    senderId: data.senderId,
    fileName: data.fileName,
    fileSize: data.fileSize,
    fileType: data.fileType
  };
  
  document.getElementById('senderIdModal').textContent = data.senderId;
  document.getElementById('incomingFileName').textContent = data.fileName;
  document.getElementById('incomingFileInfo').textContent = 
    `${formatFileSize(data.fileSize)} • ${data.fileType || 'Unknown type'}`;
  
  console.log('🔔 Showing modal for file offer');
  document.getElementById('incomingModal').style.display = 'flex';
}

// Accept file
function acceptFile() {
  console.log('✅ Accepting file from:', currentTransfer.senderId);
  document.getElementById('incomingModal').style.display = 'none';
  
  const message = {
    type: 'file-accept',
    targetId: currentTransfer.senderId
  };
  
  console.log('📨 Sending accept message:', message);
  ws.send(JSON.stringify(message));
  
  receivedChunks = [];
  showTransferProgress('Receiving...', currentTransfer.senderId, 0);
}

// Reject file
function rejectFile() {
  console.log('❌ Rejecting file from:', currentTransfer.senderId);
  document.getElementById('incomingModal').style.display = 'none';
  
  ws.send(JSON.stringify({
    type: 'file-reject',
    targetId: currentTransfer.senderId
  }));
  
  currentTransfer = null;
}

// Handle file acceptance
async function handleFileAccept(data) {
  console.log('📤 File accepted! Starting transfer...');
  
  const file = currentTransfer.file;
  const chunkSize = 64 * 1024; // 64KB chunks
  const totalChunks = Math.ceil(file.size / chunkSize);
  
  console.log(`📦 Total chunks to send: ${totalChunks}`);
  
  showTransferProgress('Sending...', data.senderId, 0);
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      ws.send(JSON.stringify({
        type: 'file-chunk',
        targetId: data.senderId,
        chunk: e.target.result,
        chunkIndex: i,
        totalChunks: totalChunks
      }));
      
      const progress = ((i + 1) / totalChunks) * 100;
      updateTransferProgress(progress);
      
      if (i % 10 === 0) { // Log every 10th chunk
        console.log(`📊 Progress: ${Math.round(progress)}%`);
      }
    };
    reader.readAsDataURL(chunk);
    
    // Small delay between chunks
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  console.log('✅ All chunks sent, sending complete message');
  ws.send(JSON.stringify({
    type: 'file-complete',
    targetId: data.senderId
  }));
}

// Handle file rejection
function handleFileReject(data) {
  hideTransferProgress();
  alert('File transfer was rejected');
  currentTransfer = null;
}

// Handle file chunk
function handleFileChunk(data) {
  receivedChunks.push({
    index: data.chunkIndex,
    data: data.chunk
  });
  
  const progress = (receivedChunks.length / data.totalChunks) * 100;
  updateTransferProgress(progress);
  
  if (data.chunkIndex % 10 === 0) {
    console.log(`📥 Receiving: ${Math.round(progress)}%`);
  }
}

// Handle file complete
function handleFileComplete(data) {
  console.log('🎉 File transfer complete!');
  hideTransferProgress();
  
  // Sort chunks by index
  receivedChunks.sort((a, b) => a.index - b.index);
  console.log(`📦 Total chunks received: ${receivedChunks.length}`);
  
  try {
    // Combine chunks - handle different data formats
    const binaryData = [];
    
    for (let i = 0; i < receivedChunks.length; i++) {
      const chunk = receivedChunks[i].data;
      console.log(`Processing chunk ${i}, type: ${typeof chunk}`);
      
      // Extract base64 data (remove data:*/*;base64, prefix if present)
      let base64String = chunk;
      if (typeof chunk === 'string' && chunk.includes(',')) {
        base64String = chunk.split(',')[1];
      }
      
      // Decode base64 to binary
      try {
        const binaryString = atob(base64String);
        const bytes = new Uint8Array(binaryString.length);
        for (let j = 0; j < binaryString.length; j++) {
          bytes[j] = binaryString.charCodeAt(j);
        }
        binaryData.push(bytes);
      } catch (decodeError) {
        console.error(`Error decoding chunk ${i}:`, decodeError);
        throw new Error(`Failed to decode chunk ${i}`);
      }
    }
    
    // Calculate total size
    const totalSize = binaryData.reduce((sum, chunk) => sum + chunk.length, 0);
    console.log(`📊 Total file size: ${totalSize} bytes`);
    
    // Combine all chunks into single array
    const combinedArray = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of binaryData) {
      combinedArray.set(chunk, offset);
      offset += chunk.length;
    }
    
    console.log(`✅ Combined array size: ${combinedArray.length} bytes`);
    
    // Create blob with proper type
    const mimeType = currentTransfer.fileType || 'application/octet-stream';
    const blob = new Blob([combinedArray], { type: mimeType });
    
    console.log(`💾 Blob created: ${blob.size} bytes, type: ${blob.type}`);
    
    // Create download link
    const url = URL.createObjectURL(blob);
    
    console.log('✅ File ready for download');
    
    // Add to received files list
    addReceivedFile({
      name: currentTransfer.fileName,
      size: currentTransfer.fileSize,
      url: url,
      from: data.senderId
    });
    
    // Reset
    receivedChunks = [];
    currentTransfer = null;
    
  } catch (error) {
    console.error('❌ Error processing file:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    alert('Error processing received file: ' + error.message);
    
    // Reset anyway
    receivedChunks = [];
    currentTransfer = null;
  }
}

// Show transfer progress
function showTransferProgress(status, peerId, progress) {
  const card = document.getElementById('transferCard');
  card.style.display = 'block';
  
  document.getElementById('transferFileName').textContent = 
    currentTransfer.file ? currentTransfer.file.name : currentTransfer.fileName;
  document.getElementById('transferPeer').textContent = 
    `${status} ${peerId}`;
  
  updateTransferProgress(progress);
}

// Update transfer progress
function updateTransferProgress(progress) {
  document.getElementById('progressFill').style.width = progress + '%';
  document.getElementById('progressPercent').textContent = Math.round(progress) + '%';
  
  if (currentTransfer && currentTransfer.startTime) {
    const elapsed = (Date.now() - currentTransfer.startTime) / 1000;
    const fileSize = currentTransfer.file ? currentTransfer.file.size : currentTransfer.fileSize;
    const transferred = (fileSize * progress) / 100;
    const speed = transferred / elapsed;
    document.getElementById('progressSpeed').textContent = formatFileSize(speed) + '/s';
  }
}

// Hide transfer progress
function hideTransferProgress() {
  setTimeout(() => {
    document.getElementById('transferCard').style.display = 'none';
    document.getElementById('progressFill').style.width = '0%';
  }, 2000);
}

// Add received file to list
function addReceivedFile(fileData) {
  const receivedFiles = document.getElementById('receivedFiles');
  
  // Remove empty state if exists
  const emptyState = receivedFiles.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
  
  const fileItem = document.createElement('div');
  fileItem.className = 'received-file-item';
  fileItem.innerHTML = `
    <div class="file-info-left">
      <span class="file-icon">📄</span>
      <div class="file-details-text">
        <span class="file-name">${fileData.name}</span>
        <span class="file-meta">${formatFileSize(fileData.size)} • from ${fileData.from}</span>
      </div>
    </div>
    <a href="${fileData.url}" download="${fileData.name}" class="btn-download">
      Download
    </a>
  `;
  
  receivedFiles.insertBefore(fileItem, receivedFiles.firstChild);
  
  console.log('✅ File added to received list');
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Initialize on page load
window.addEventListener('load', () => {
  console.log('🚀 App starting...');
  loadQRCode();
  initWebSocket();
});
