// What the worker may ask the Docker daemon. Anything not listed here is refused, so a compromised worker cannot use the socket to
// start a privileged container, mount the host's root or run a command in someone else's container.
import path from 'node:path';

const ID = '[A-Za-z0-9_.-]+';
const ALLOWED = [
  ['GET', /^\/_ping$/],
  ['HEAD', /^\/_ping$/],
  ['GET', /^\/version$/],
  ['GET', /^\/containers\/json$/],
  ['POST', /^\/containers\/create$/],
  ['POST', new RegExp(`^/containers/${ID}/(start|wait|kill|stop|resize)$`)],
  ['POST', new RegExp(`^/containers/${ID}/attach$`)],
  ['GET', new RegExp(`^/containers/${ID}/(json|logs)$`)],
  ['DELETE', new RegExp(`^/containers/${ID}$`)],
  ['GET', /^\/images\/.+\/json$/],
  ['POST', /^\/images\/create$/],
];

const root = (user) => user === undefined || user === '' || user === '0' || /^root(:|$)/.test(String(user)) || /^0:/.test(String(user));

/** The request path without the API version prefix (`/v1.43/containers/json` -> `/containers/json`) and query. */
export const cleanPath = (url) => (url.split('?')[0] ?? '').replace(/^\/v\d+(\.\d+)?(?=\/)/, '');

/** Null when a request is allowed, else why not. `createBody` is the parsed JSON of POST /containers/create. */
export function checkRequest(method, url, createBody, opts = {}) {
  const p = cleanPath(url);
  if (!ALLOWED.some(([m, re]) => m === method && re.test(p))) return `${method} ${p} is not allowed`;
  if (method === 'POST' && p === '/containers/create') return checkCreate(createBody, opts);
  return null;
}

export function checkCreate(body, { bindRoots = [], volumePrefix = 'sdlc_' } = {}) {
  if (!body || typeof body !== 'object') return 'the create request has no JSON body';
  const hc = body.HostConfig ?? {};
  if (hc.Privileged) return 'privileged containers are not allowed';
  for (const k of ['PidMode', 'IpcMode', 'UsernsMode', 'UTSMode', 'CgroupnsMode', 'Cgroup', 'CgroupParent']) if (hc[k]) return `HostConfig.${k} is not allowed`;
  if ((hc.CapAdd ?? []).length > 0) return 'adding capabilities is not allowed';
  for (const k of ['Devices', 'DeviceRequests', 'DeviceCgroupRules', 'Mounts', 'VolumesFrom', 'Links']) if ((hc[k] ?? []).length > 0) return `HostConfig.${k} is not allowed`;
  if (hc.Runtime && !['runsc', 'sysbox-runc', 'runc'].includes(hc.Runtime)) return `runtime ${hc.Runtime} is not allowed`;
  const net = hc.NetworkMode ?? '';
  if (!net.startsWith(volumePrefix)) return `the network ${net || '(default)'} is not allowed`;
  for (const opt of hc.SecurityOpt ?? []) if (!/^no-new-privileges(:true)?$/.test(opt)) return `SecurityOpt ${opt} is not allowed`;
  if (root(body.User)) return 'containers must run as a non-root user';
  if (body.Domainname || body.Volumes) return 'unexpected volume or domain settings';
  for (const bind of hc.Binds ?? []) {
    const [src] = String(bind).split(':');
    if (src.startsWith('/')) {
      const norm = path.posix.normalize(src);
      if (norm !== src) return `bind source ${src} is not normalised`;
      if (!bindRoots.some((r) => norm === r || norm.startsWith(r.replace(/\/+$/, '') + '/'))) return `bind source ${src} is outside the data folder`;
    } else if (!new RegExp(`^${volumePrefix}[A-Za-z0-9_.-]+$`).test(src)) {
      return `volume ${src} is not one of ours`;
    }
  }
  return null;
}
