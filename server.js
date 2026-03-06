// Ponto de entrada principal — delega para src/server.js
require('dotenv').config();
const { startServer } = require('./src/server');
startServer();