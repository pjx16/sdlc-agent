import { readFileSync } from 'node:fs';
import { createBroker } from './server';
import { Store } from './store';

const need = (name: string): string => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

// The private key is either the PEM itself (with \n escapes) or a path to the file.
const keyValue = need('GITHUB_APP_PRIVATE_KEY');
const privateKey = keyValue.includes('BEGIN') ? keyValue.replace(/\\n/g, '\n') : readFileSync(keyValue, 'utf8');

const server = createBroker({
  app: { appId: need('GITHUB_APP_ID'), slug: need('GITHUB_APP_SLUG'), privateKey, clientId: need('GITHUB_APP_CLIENT_ID'), clientSecret: need('GITHUB_APP_CLIENT_SECRET') },
  publicUrl: need('BROKER_PUBLIC_URL'),
  registrationSecret: process.env.BROKER_REGISTRATION_SECRET?.trim() || undefined,
  store: new Store(process.env.BROKER_DATA_FILE ?? '/data/broker.json'),
});
// The broker speaks plain HTTP: run it behind a TLS reverse proxy (BROKER_PUBLIC_URL must be the https address). Keys and tokens cross this link.
const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`sdlc-agent token broker listening on ${port}`));
