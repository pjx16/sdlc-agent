// A filtering proxy in front of /var/run/docker.sock. The worker talks to it (DOCKER_HOST=tcp://docker-proxy:2375); it forwards only the
// calls in policy.mjs, one request per connection (Connection: close), and inspects the body of every container create.
import net from 'node:net';
import { checkRequest } from './policy.mjs';

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const PORT = Number(process.env.PORT || 2375);
const bindRoots = (process.env.ALLOWED_BIND_ROOTS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const MAX_HEAD = 16 * 1024;
const MAX_BODY = 1024 * 1024;

const deny = (socket, why) => {
  const body = JSON.stringify({ message: `docker-proxy: ${why}` });
  socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  console.warn(`refused: ${why}`);
};

net.createServer((client) => {
  let buf = Buffer.alloc(0);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) return buf.length > MAX_HEAD ? (client.removeListener('data', onData), deny(client, 'request head too large')) : undefined;
    const head = buf.subarray(0, end).toString('latin1');
    const [line, ...headerLines] = head.split('\r\n');
    const [method, url] = line.split(' ');
    const headers = Object.fromEntries(headerLines.map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
    if (headers['transfer-encoding']) return (client.removeListener('data', onData), deny(client, 'chunked requests are not allowed'));
    const length = Number(headers['content-length'] || 0);
    const isCreate = method === 'POST' && /\/containers\/create$/.test((url || '').split('?')[0]);
    if (isCreate && length > MAX_BODY) return (client.removeListener('data', onData), deny(client, 'body too large'));
    if (isCreate && buf.length < end + 4 + length) return; // wait for the whole body
    client.removeListener('data', onData);
    let body;
    if (isCreate) {
      try { body = JSON.parse(buf.subarray(end + 4, end + 4 + length).toString('utf8')); } catch { return deny(client, 'the body is not JSON'); }
    }
    const why = checkRequest(method, url || '', body, { bindRoots });
    if (why) return deny(client, why);
    const upgrade = /upgrade/i.test(headers.connection || '');
    const rewritten = upgrade ? head : [line, ...headerLines.filter((l) => !/^connection:/i.test(l)), 'Connection: close'].join('\r\n');
    const upstream = net.connect(SOCKET);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    upstream.write(Buffer.concat([Buffer.from(`${rewritten}\r\n\r\n`, 'latin1'), buf.subarray(end + 4)]));
    client.pipe(upstream);
    upstream.pipe(client);
  };
  client.on('data', onData);
  client.on('error', () => undefined);
}).listen(PORT, '0.0.0.0', () => console.log(`docker-proxy on :${PORT} -> ${SOCKET}, bind roots: ${bindRoots.join(', ') || '(none)'}`));
