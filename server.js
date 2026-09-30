const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const RFSimulation = require('./simulation');
const HeatmapGenerator = require('./heatmap');
const { CONFIG } = require('./config/constants');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const simulation = new RFSimulation();
let simulationData = null;

function updateSimulation() {
  simulation.updatePositions();
  const rfSources = simulation.getSourceData();
  const heatmap = HeatmapGenerator.generate(rfSources);
  const receivers = HeatmapGenerator.getReceiverNodes();
  const stats = HeatmapGenerator.calculateStats(heatmap);

  simulationData = {
    timestamp: new Date().toISOString(),
    heatmap,
    sources: simulation.getSources(),
    receivers,
    stats,
    roomWidth: CONFIG.ROOM_WIDTH,
    roomHeight: CONFIG.ROOM_HEIGHT,
  };
  return simulationData;
}

const simulationInterval = setInterval(() => {
  const data = updateSimulation();
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}, CONFIG.UPDATE_RATE);

wss.on('connection', (ws) => {
  if (simulationData) ws.send(JSON.stringify(simulationData));
});

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(
    `Server running on http://localhost:${CONFIG.PORT} ` +
      `(room ${CONFIG.ROOM_WIDTH}x${CONFIG.ROOM_HEIGHT} m, ` +
      `update ${CONFIG.UPDATE_RATE}ms)`
  );
});

process.on('SIGINT', () => {
  clearInterval(simulationInterval);
  wss.clients.forEach((client) => client.close());
  server.close();
  process.exit(0);
});
