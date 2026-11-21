// Development only (scripts/dev.sh). The worker runs on the host there, so nothing on the agent network answers to `llm-gateway`.
// This relay joins the agent network under that name and passes each TCP connection on to the worker's LLM gateway on the host.
// The gateway still checks every request's per-run key, as in production.
import net from 'node:net';

const LISTEN_PORT = Number(process.env.LISTEN_PORT || 8080);
const TARGET_HOST = process.env.TARGET_HOST || 'host.docker.internal';
const TARGET_PORT = Number(process.env.TARGET_PORT || 8080);

net
  .createServer((client) => {
    const upstream = net.connect(TARGET_PORT, TARGET_HOST);
    client.pipe(upstream).pipe(client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    upstream.on('error', (err) => {
      console.error(`llm-gateway relay: ${TARGET_HOST}:${TARGET_PORT} unreachable (${err.code ?? err.message}); is the worker running?`);
      close();
    });
    client.on('error', close);
  })
  .listen(LISTEN_PORT, () => console.log(`llm-gateway relay: :${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`));
