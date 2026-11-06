import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';

// Controlled process barriers: arrival is an observed message, release is explicit.
export async function processGates(signal) {
  const values = new Map();
  const waiters = new Map();
  const sockets = new Set();
  const publish = (key, value = true) => {
    values.set(key, value);
    for (const resolve of waiters.get(key) ?? []) resolve(value);
    waiters.delete(key);
  };
  const wait = key => {
    signal?.throwIfAborted();
    if (values.has(key)) return Promise.resolve(values.get(key));
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const done = value => { signal?.removeEventListener('abort', abort); resolve(value); };
      waiters.set(key, [...(waiters.get(key) ?? []), done]);
    });
  };
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    let input = '';
    socket.on('data', data => {
      input += data;
      if (!input.includes('\n')) return;
      socket.removeAllListeners('data');
      const message = JSON.parse(input.slice(0, input.indexOf('\n')));
      if (message.operation === 'publish') {
        publish(message.key, message.value);
        socket.end('true\n');
      } else {
        wait(message.key).then(value => socket.end(JSON.stringify(value) + '\n'), () => socket.destroy());
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { endpoint: server.address().port, publish, wait, has: key => values.has(key), async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

export async function processGate(endpoint, operation, key, value, signal = operation === 'wait' ? undefined : AbortSignal.timeout(60000)) {
  // A release barrier belongs to the parent test lifecycle, not a hidden timer.
  // Its server closes/aborts the socket when that test ends.
  signal?.throwIfAborted();
  const socket = createConnection({ host: '127.0.0.1', port: Number(endpoint), signal });
  try {
    await once(socket, 'connect');
    const result = new Promise((resolve, reject) => {
      let input = '';
      socket.on('data', data => { input += data; if (input.includes('\n')) resolve(JSON.parse(input.slice(0, input.indexOf('\n')))); });
      socket.once('error', reject);
      socket.once('end', () => { if (!input.includes('\n')) reject(new Error('Process gate closed before response')); });
    });
    socket.write(JSON.stringify({ operation, key, value }) + '\n');
    return await result;
  } catch (error) {
    throw new Error(`Process gate ${operation}:${key} failed: ${error.message}`, { cause: error });
  } finally { socket.destroy(); }
}
