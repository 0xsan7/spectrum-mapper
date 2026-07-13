# Spectrum Mapper

Real-time RF signal distribution visualization system. Simulates 4 RF transmitters broadcasting at 5-20 dBm and 4 receiver nodes monitoring signal strength.

## Setup

```bash
npm install
npm start
```

Open http://localhost:3000

## What It Does

- Simulates RF sources with path loss propagation model
- Calculates RSSI using free-space formula
- Renders real-time heatmap (blue=weak, red=strong)
- WebSocket streaming at 2 Hz
- Interactive dashboard with controls

## What You Learn

- RF propagation and path loss models
- Real-time data streaming (WebSocket)
- Canvas rendering and color mapping
- IoT mesh network architecture
- Full-stack JavaScript development

## Features

- Real-time heatmap visualization
- 4 transmitters (mobile and stationary)
- 4 receiver monitoring nodes
- Statistics panel (max/min/avg RSSI)
- Pause/Resume controls
- Responsive dark theme UI
- Keyboard shortcuts
- Data export functionality

## Technical Stack

Backend: Node.js + Express + WebSocket
Frontend: HTML5 Canvas + Vanilla JavaScript + CSS3

## License

MIT
