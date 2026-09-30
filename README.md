# Spectrum Mapper

**Real-time RF signal distribution visualization system with interactive heatmap rendering**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v14+-green)](https://nodejs.org/)
[![WebSocket](https://img.shields.io/badge/WebSocket-Real--time-blue)](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

## Overview

Spectrum Mapper is a full-stack IoT visualization platform that simulates RF signal propagation across a defined space. The system renders real-time heatmaps showing signal intensity distribution from multiple wireless transmitters monitored by fixed receiver nodes.

Built with modern web technologies and clean architecture, this project demonstrates professional-grade IoT system design with real-time data streaming, signal processing, and interactive visualization.

## Key Features

- **Real-time Heatmap Visualization** - Canvas-based rendering at 2 Hz update rate
- **RF Propagation Simulation** - Realistic path loss model using free-space formula
- **Multi-Source Tracking** - 4 RF transmitters with configurable power levels (5-20 dBm)
- **Distributed Monitoring** - 4 fixed receiver nodes capturing signal strength
- **Interactive Dashboard** - Pause/resume controls, statistics panel, responsive layout
- **WebSocket Streaming** - Bi-directional real-time communication with automatic reconnection
- **Production-Ready Code** - Clean architecture, error handling, performance optimization
- **Cross-Platform** - Works on macOS, Linux, Windows with Node.js 14+

## Architecture

┌─────────────────────────────────────────────────────┐
│ Browser (Client) │
│ ┌──────────────────────────────────────────────┐ │
│ │ Canvas Heatmap Renderer (HTML5 Canvas API) │ │
│ │ - Color interpolation (blue → red gradient) │ │
│ │ - 1m x 1m grid resolution │ │
│ │ - Real-time updates @ 60 FPS │ │
│ └──────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ Interactive Dashboard │ │
│ │ - Transmitter/receiver info │ │
│ │ - Live statistics (RSSI min/max/avg) │ │
│ │ - Control panel (pause/reset) │ │
│ └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
WebSocket (500ms, real-time)
↕
┌─────────────────────────────────────────────────────┐
│ Node.js Server (Backend) │
│ ┌──────────────────────────────────────────────┐ │
│ │ RF Source Simulator │ │
│ │ - 4 transmitters with velocity vectors │ │
│ │ - Position updates with boundary wrapping │ │
│ │ - Configurable TX power (5-20 dBm) │ │
│ └──────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ Path Loss Propagation Model │ │
│ │ - RSSI = TxPower - 20*log10(dist) - fading │ │
│ │ - Grid-based calculation (300 points) │ │
│ │ - Random environmental effects │ │
│ └──────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ WebSocket Server (ws library) │ │
│ │ - 2 Hz broadcast rate (500ms interval) │ │
│ │ - Automatic client connection management │ │
│ │ - JSON data protocol │ │
│ └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘

## Installation & Setup

### Requirements

- **Node.js** 14.0 or higher ([download](https://nodejs.org/))
- **npm** 6.0 or higher (included with Node.js)
- **Modern web browser** (Chrome, Firefox, Safari, Edge)

### Quick Start

```bash
# Clone and navigate to project
git clone https://github.com/0xsan7/spectrum-mapper.git
cd spectrum-mapper

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on `http://localhost:3000`

Open your browser and navigate to: **http://localhost:3000**

## Usage Guide

### Dashboard Interface

**Heatmap View (Main Panel)**

- Colored grid showing RF signal intensity across 20m × 15m space
- Grid resolution: 1m × 1m cells
- Color scale: Blue (weak -100 dBm) → Red (strong -20 dBm)
- Magenta dots: RF transmitter positions
- Green squares: Receiver node positions

**Signal Intensity Zones**
-100 to -75 dBm → Blue (Weak signal)
-75 to -50 dBm → Green (Moderate signal)
-50 to -35 dBm → Yellow (Strong signal)
-35 to -20 dBm → Orange (Very strong)
**Control Panel (Right Sidebar)**

- **Transmitters** - Lists all RF sources with position and power
- **Receivers** - Shows fixed monitoring node positions
- **Statistics** - Max/Min/Average RSSI and hotspot count
- **Controls** - Pause/Resume simulation, Reset to initial state

### Keyboard Shortcuts

| Key     | Action                  |
| ------- | ----------------------- |
| `Space` | Pause/Resume simulation |
| `R`     | Reset dashboard         |
| `?`     | Show help               |

## Technical Specifications

### Simulation Parameters

| Parameter         | Value           |
| ----------------- | --------------- |
| Room Dimensions   | 20m × 15m       |
| Grid Resolution   | 1m × 1m cells   |
| Update Rate       | 2 Hz (500ms)    |
| RSSI Range        | -100 to -20 dBm |
| Total Grid Points | 300 cells       |

### RF Transmitters

| Source               | Power  | Type      | Behavior                |
| -------------------- | ------ | --------- | ----------------------- |
| TX-1 (Router A)      | 20 dBm | WiFi      | Stationary (2, 13)      |
| TX-2 (Router B)      | 15 dBm | WiFi      | Stationary (18, 13)     |
| TX-3 (Mobile Device) | 10 dBm | Personal  | Mobile with velocity    |
| TX-4 (BLE Beacon)    | 5 dBm  | Bluetooth | Mobile with random walk |

### Receiver Nodes

| Node | Position | Type         |
| ---- | -------- | ------------ |
| RX-1 | (2, 2)   | Corner       |
| RX-2 | (18, 2)  | Corner       |
| RX-3 | (10, 13) | Back wall    |
| RX-4 | (10, 2)  | Front center |

### Performance Metrics

- **Heatmap Generation**: ~50ms
- **WebSocket Broadcast**: ~20ms
- **Canvas Rendering**: ~30ms
- **Total Cycle Time**: 500ms (2 Hz)
- **End-to-End Latency**: 250-300ms
- **Memory Usage**: ~50-100 MB

## Project Structure

spectrum-mapper/
├── server.js # Main server + WebSocket + simulation loop
├── simulation.js # RF source position updates
├── pathLoss.js # RSSI calculation using path loss model
├── heatmap.js # Heatmap grid generation + statistics
├── config/
│ └── constants.js # Simulation parameters + RF definitions
├── public/
│ ├── index.html # Dashboard HTML structure
│ ├── style.css # Dark theme styling (responsive)
│ ├── dashboard.js # Main application logic
│ ├── websocket.js # WebSocket client connection
│ ├── heatmap.js # Canvas rendering pipeline
│ ├── colors.js # Color interpolation algorithm
│ ├── performance.js # Performance utilities
│ ├── logger.js # Error handling + logging
│ ├── responsive.js # Mobile responsiveness
│ ├── shortcuts.js # Keyboard shortcuts
│ └── export.js # Data export functionality
├── package.json # Dependencies
├── README.md # This file
└── .gitignore # Git ignore patterns

## Technical Stack

### Backend

- **Node.js** - JavaScript runtime
- **Express.js** - HTTP server framework
- **WebSocket (ws)** - Real-time bidirectional communication
- **Pure JavaScript** - No additional dependencies for simulation

### Frontend

- **HTML5** - Semantic markup
- **CSS3** - Responsive dark theme styling
- **Canvas API** - High-performance graphics rendering
- **Vanilla JavaScript** - No frameworks (lightweight, fast)
- **WebSocket API** - Real-time data streaming

## Dependencies

```json
{
  "express": "^4.18.2", // HTTP server
  "ws": "^8.14.2" // WebSocket library
}
```

Total: 70 packages (including transitive dependencies)

## What You'll Learn

### 1. RF/Wireless Concepts

- Free-space path loss propagation model
- RSSI (Received Signal Strength Indicator) calculation
- Signal attenuation over distance
- Environmental fading effects
- Multi-path propagation simulation

### 2. Real-Time Systems

- WebSocket bi-directional communication
- Event-driven architecture
- Real-time data streaming at 2 Hz
- Automatic reconnection handling
- Connection pooling

### 3. Data Visualization

- Canvas API performance optimization
- Color interpolation algorithms (linear mapping)
- Grid-based spatial data rendering
- Real-time animation at 60 FPS
- Responsive layout design

### 4. IoT Architecture

- Distributed sensor mesh networks
- Fixed monitoring nodes with mobile transmitters
- Centralized data aggregation
- Scalable system design patterns
- Simulation vs. real hardware

### 5. Full-Stack Development

- Node.js backend architecture
- Frontend rendering pipeline
- Client-server communication patterns
- Error handling and logging
- Production-ready code quality

## API Reference

### Server Endpoints

**GET /** - Serves static files from `/public` directory

### WebSocket Events

**Server → Client (every 500ms)**

```json
{
  "timestamp": "2024-07-11T22:30:00.000Z",
  "heatmap": [
    { "x": 0, "y": 0, "rssi": -85.5 },
    ...
  ],
  "sources": [
    { "id": "TX-1", "name": "Router A", "x": 2, "y": 13, "txPower": 20 },
    ...
  ],
  "receivers": [
    { "id": "RX-1", "x": 2, "y": 2 },
    ...
  ],
  "stats": {
    "maxRSSI": "-20.5",
    "minRSSI": "-98.2",
    "avgRSSI": "-65.3",
    "hotspotCount": 42
  },
  "roomWidth": 20,
  "roomHeight": 15
}
```

## Performance Optimization

The system is optimized for real-time performance:

- **Grid Caching** - Pre-calculated cell positions
- **Binary Search** - RSSI lookups in O(log n)
- **RequestAnimationFrame** - Smooth 60 FPS rendering
- **WebSocket Batching** - Single broadcast per update cycle
- **Memory Pooling** - Reusable canvas buffers

## Future Enhancements

### Phase 2 (Advanced Visualization)

- [ ] 3D heatmap with Three.js
- [ ] Historical RSSI time series graphs
- [ ] Source movement trails
- [ ] Animated signal propagation
- [ ] Export heatmap as PNG/PDF

### Phase 3 (Real Hardware)

- [ ] ESP32 firmware integration
- [ ] LoRa mesh network support
- [ ] MQTT broker connectivity
- [ ] Multi-room deployment
- [ ] Cloud data storage

### Phase 4 (Production)

- [ ] Mobile app (React Native)
- [ ] User authentication
- [ ] Database persistence
- [ ] Outdoor WiFi mapping
- [ ] Advanced ML predictions

## Troubleshooting

**Problem: Server won't start**

```bash
# Check if port 3000 is already in use
lsof -i :3000

# Use different port
PORT=3001 npm start
```

**Problem: Dashboard not loading**

- Clear browser cache (Cmd+Shift+R on macOS)
- Check browser console for errors (F12)
- Verify WebSocket connection in Network tab

**Problem: Heatmap not updating**

- Check server console for errors
- Verify WebSocket status shows "Connected"
- Try refreshing the page

## Contributing

This is a complete project. Feel free to fork and extend with:

- Real hardware integration
- Advanced visualizations
- Additional RF models
- Performance improvements

## License

MIT License - See LICENSE file for details

## Author

Santiago Jerald (@0xsan7)

---

**Status**: Production-Ready MVP (v1.0.0)  
**Last Updated**: July 2024  
**Commits**: 18 (3-day sprint)  
**Lines of Code**: ~1200 (backend + frontend)

Made with JavaScript for IoT enthusiasts and engineers.
