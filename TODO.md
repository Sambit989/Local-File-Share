# Optimize File Transfer Speed - Implement WebRTC P2P

## Tasks
- [ ] Update server/server.js to handle WebRTC signaling messages
- [ ] Update client/app.js to implement WebRTC peer connection and data channel
- [ ] Add STUN server configuration for NAT traversal
- [ ] Test peer-to-peer transfer speeds
- [ ] Ensure WebSocket fallback works if WebRTC fails

## Current Issue
File chunks are routed through server (sender -> server -> receiver), causing bottleneck on server bandwidth.

## Solution
Implement WebRTC data channels for direct peer-to-peer file transfer, using server only for signaling.
