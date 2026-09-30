const { loadEnv, numEnv } = require('./env');

loadEnv();

const CONFIG = {
  ROOM_WIDTH: numEnv('ROOM_WIDTH', 20),
  ROOM_HEIGHT: numEnv('ROOM_HEIGHT', 15),
  GRID_RESOLUTION: numEnv('GRID_RESOLUTION', 1),
  UPDATE_RATE: numEnv('UPDATE_RATE', 500),
  MIN_RSSI: numEnv('MIN_RSSI', -100),
  MAX_RSSI: numEnv('MAX_RSSI', -20),
  PORT: numEnv('PORT', 3000),
  HOST: process.env.HOST || '0.0.0.0',
};

const RF_SOURCES = [
  { id: 'TX-1', name: 'Router A', txPower: 20, x: 2, y: 13, vx: 0, vy: 0 },
  { id: 'TX-2', name: 'Router B', txPower: 15, x: 18, y: 13, vx: 0, vy: 0 },
  {
    id: 'TX-3',
    name: 'Mobile Device',
    txPower: 10,
    x: 10,
    y: 7,
    vx: 0.15,
    vy: 0.1,
  },
  {
    id: 'TX-4',
    name: 'BLE Beacon',
    txPower: 5,
    x: 5,
    y: 5,
    vx: 0.08,
    vy: -0.12,
  },
];

const RECEIVER_NODES = [
  { id: 'RX-1', x: 2, y: 2 },
  { id: 'RX-2', x: 18, y: 2 },
  { id: 'RX-3', x: 10, y: 13 },
  { id: 'RX-4', x: 10, y: 2 },
];

module.exports = { CONFIG, RF_SOURCES, RECEIVER_NODES };
