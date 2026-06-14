const { buildSnapshot } = require('../services/statsService');

/**
 * Socket layer is intentionally tiny: clients connect, get the current
 * snapshot, then sit and listen for `queue:updated` broadcasts that
 * REST mutations trigger. No client-issued mutations over sockets —
 * keeping the write path on REST means every change is auditable and
 * the socket can never get out of sync with the database.
 */
module.exports = function registerSockets(io) {
  io.on('connection', async (socket) => {
    try {
      const snapshot = await buildSnapshot();
      socket.emit('queue:snapshot', snapshot);
    } catch (err) {
      console.error('snapshot send failed', err);
    }

    socket.on('queue:resync', async () => {
      // Clients call this after a network blip to reconcile state.
      try {
        const snapshot = await buildSnapshot();
        socket.emit('queue:snapshot', snapshot);
      } catch (err) {
        console.error('resync failed', err);
      }
    });
  });
};
