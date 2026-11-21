// A filtering proxy in front of /var/run/docker.sock. The worker talks to it (DOCKER_HOST=tcp://docker-proxy:2375); it forwards only the
// calls in policy.mjs, inspects the body of every container create, and checks the agent label of every container a call acts on.
//
// Exactly one request per connection: the request is read whole (head and body), checked, and sent upstream with `Connection: close`.
// Nothing the client sends after it is forwarded, so a second, unchecked request cannot ride on a connection the daemon keeps open.
// The one exception is the attach stream, the only route allowed to upgrade; once upgraded the daemon reads raw stdin, not HTTP.
import http from 'node:http';
import net from 'node:net';
import { AGENT_LABEL_KEY, AGENT_LABEL_VALUE, UPGRADE_ROUTE, classify, cleanPath, forceLabelFilter } from './policy.mjs';

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const PORT = Number(process.env.PORT || 2375);
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const opts = {
  bindRoots: list(process.env.ALLOWED_BIND_ROOTS).map((s) => s.replace(/\/+$/, '')),
  // Installs: the data volume agents mount sub-paths of (no host bind roots then). Development: unset, host bind roots instead.
  dataVolume: (process.env.ALLOWED_DATA_VOLUME || '').trim(),
  images: list(process.env.ALLOWED_IMAGES),
  networks: list(process.env.ALLOWED_NETWORKS || 'sdlc_agent_net'),
};
const MAX_HEAD = 16 * 1024;
const MAX_BODY = 1024 * 1024;
/** Hop-by-hop headers the client may not choose: the proxy decides how the upstream connection behaves. */
const HOP = /^(connection|upgrade|keep-alive|proxy-connection|te|trailer|transfer-encoding):/i;

const reply = (socket, status, text, why) => {
  const body = JSON.stringify({ message: `docker-proxy: ${why}` });
  socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
};
const deny = (socket, why) => {
  reply(socket, 403, 'Forbidden', why);
  console.warn(`refused: ${why}`);
};

/** The labels of one container, or null when the daemon does not know it. */
const labelsOf = (id) => new Promise((resolve, reject) => {
  const req = http.request({ socketPath: SOCKET, method: 'GET', path: `/containers/${encodeURIComponent(id)}/json` }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (d) => (data += d));
    res.on('end', () => {
      if (res.statusCode === 404) return resolve(null);
      if (res.statusCode !== 200) return reject(new Error(`inspect answered ${res.statusCode}`));
      try { resolve(JSON.parse(data)?.Config?.Labels ?? {}); } catch (err) { reject(err); }
    });
  });
  req.on('error', reject);
  req.end();
});

async function handle(client, head, body) {
  const [line, ...headerLines] = head.split('\r\n');
  const [method, url = '', version] = line.split(' ');
  if (!method || !url.startsWith('/') || !/^HTTP\/1\.[01]$/.test(version ?? '')) return deny(client, 'malformed request line');
  let parsed;
  if (method === 'POST' && cleanPath(url) === '/containers/create') {
    try { parsed = JSON.parse(body.toString('utf8')); } catch { return deny(client, 'the body is not JSON'); }
  }
  const { why, route } = classify(method, url, parsed, opts);
  if (why) return deny(client, why);

  if (route.kind === 'container') {
    let labels;
    try { labels = await labelsOf(route.id); } catch (err) { return deny(client, `could not inspect ${route.id}: ${err.message}`); }
    // A missing container is reported as missing, so the worker's "already gone" handling keeps working.
    if (labels === null) return reply(client, 404, 'Not Found', `no such container: ${route.id}`);
    if (labels[AGENT_LABEL_KEY] !== AGENT_LABEL_VALUE) return deny(client, `container ${route.id} is not an agent container`);
  }

  const target = route.kind === 'list' ? forceLabelFilter(url) : url;
  const wantsUpgrade = headerLines.some((l) => /^upgrade:/i.test(l)) && UPGRADE_ROUTE.test(cleanPath(url));
  const kept = headerLines.filter((l) => !HOP.test(l));
  const connection = wantsUpgrade ? ['Connection: Upgrade', 'Upgrade: tcp'] : ['Connection: close'];
  const upstream = net.connect(SOCKET);
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
  upstream.write(Buffer.concat([Buffer.from(`${method} ${target} ${version}\r\n${[...kept, ...connection].join('\r\n')}\r\n\r\n`, 'latin1'), body]));
  upstream.pipe(client);
  if (wantsUpgrade) client.pipe(upstream);
  else client.on('data', () => { client.destroy(); upstream.destroy(); }); // a second request on this connection: drop both ends
}

net.createServer((client) => {
  let buf = Buffer.alloc(0);
  client.on('error', () => undefined);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) {
      if (buf.length > MAX_HEAD) { client.removeListener('data', onData); deny(client, 'request head too large'); }
      return;
    }
    const head = buf.subarray(0, end).toString('latin1');
    const lengthLine = head.split('\r\n').find((l) => /^content-length:/i.test(l));
    const fail = (why) => { client.removeListener('data', onData); deny(client, why); };
    if (/\r\ntransfer-encoding:/i.test(head)) return fail('chunked requests are not allowed');
    const rawLength = lengthLine ? lengthLine.slice(lengthLine.indexOf(':') + 1).trim() : '0';
    if (!/^\d+$/.test(rawLength)) return fail('invalid Content-Length');
    if (head.split('\r\n').filter((l) => /^content-length:/i.test(l)).length > 1) return fail('more than one Content-Length');
    const length = Number(rawLength);
    if (length > MAX_BODY) return fail('body too large');
    if (buf.length < end + 4 + length) return; // wait for the whole body
    client.removeListener('data', onData);
    const isAttach = UPGRADE_ROUTE.test(cleanPath(head.split(' ')[1] ?? ''));
    // Bytes after the request are a pipelined second request, except on attach, where the client may start sending stdin early.
    if (buf.length > end + 4 + length && !isAttach) return deny(client, 'one request per connection');
    const body = buf.subarray(end + 4, end + 4 + length);
    const rest = buf.subarray(end + 4 + length);
    client.pause();
    handle(client, head, body)
      .then(() => {
        if (rest.length > 0 && !client.destroyed) client.unshift(rest);
        client.resume();
      })
      .catch((err) => deny(client, `internal error: ${err.message}`));
  };
  client.on('data', onData);
}).listen(PORT, '0.0.0.0', () => console.log(`docker-proxy on :${PORT} -> ${SOCKET}, bind roots: ${opts.bindRoots.join(', ') || '(none)'}, data volume: ${opts.dataVolume || '(none)'}, images: ${opts.images.join(', ') || '(none)'}`));
