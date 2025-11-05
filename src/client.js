import express from 'express';
import WebSocket from 'ws';

const app = express();
const PORT = 3500;

// Connect to remote WebSocket server
const ws = new WebSocket('ws://localhost:8080'); // change to your real server URL

let latestMessages = [];

// When connected
ws.on('open', () => {
  console.log('✅ Connected to WebSocket server');
  ws.send(JSON.stringify({ type: 'init', message: 'Hello from Express client!' }));
});

// When a message is received from the server
ws.on('message', (data) => {
  const text = data.toString();
  console.log('📩 WS message:', text);
  latestMessages.push(text);

  // Keep only the last 20 messages
  if (latestMessages.length > 20) latestMessages.shift();
});

// Handle disconnects or errors
ws.on('close', () => console.log('🔴 WebSocket disconnected'));
ws.on('error', (err) => console.error('⚠️ WebSocket error:', err.message));

// Express route to show recent messages
app.get('/events', (req, res) => {
  res.json({ messages: latestMessages });
});

// Example home route
app.get('/', (req, res) => {
  res.send(`
    <h2>Express + WebSocket Client</h2>
    <p>Go to <a href="/events">/events</a> to see messages.</p>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Express client running on http://localhost:${PORT}`);
});