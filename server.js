require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const connectDB = require('./src/config/db');
const apiRoutes = require('./src/routes/api');
const registerSockets = require('./src/sockets');

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  // Make io available to routes so REST handlers can broadcast after mutations.
  app.set('io', io);

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/api', apiRoutes);

  // Friendly routes for the three screens.
  app.get('/receptionist', (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'receptionist.html'))
  );
  app.get('/display', (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'display.html'))
  );
  app.get('/patient', (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'patient.html'))
  );

  registerSockets(io);

  server.listen(PORT, () => {
    console.log(`\n  Queue Cure running → http://localhost:${PORT}`);
    console.log(`   Receptionist  →  http://localhost:${PORT}/receptionist`);
    console.log(`   Waiting room  →  http://localhost:${PORT}/display`);
    console.log(`   Patient view  →  http://localhost:${PORT}/patient\n`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
