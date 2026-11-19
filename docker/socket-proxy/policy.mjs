// What the worker may ask the Docker daemon. Anything not listed here is refused, so a compromised worker (or any other container that
// reaches the proxy) cannot start a privileged container, mount the host's root, run any image but the agent image, or touch a container
// the worker did not create.
import path from 'node:path';

/** The label the worker puts on every agent container (container-options.ts). Every call on an existing container needs it. */
export const AGENT_LABEL_KEY = 'sdlc.agent';
export const AGENT_LABEL_VALUE = 'true';

const ID = '[A-Za-z0-9_.-]+';
/** [method, path pattern, kind]. `container` routes act on one existing container: the server checks its label before forwarding. */
const ALLOWED = [
  ['GET', /^\/_ping$/, 'plain'],
  ['HEAD', /^\/_ping$/, 'plain'],
  ['GET', /^\/version$/, 'plain'],
  ['GET', /^\/containers\/json$/, 'list'],
  ['POST', /^\/containers\/create$/, 'create'],
  ['POST', new RegExp(`^/containers/(${ID})/(start|wait|kill|stop|resize|attach)$`), 'container'],
  ['GET', new RegExp(`^/containers/(${ID})/(json|logs)$`), 'container'],
  ['DELETE', new RegExp(`^/containers/(${ID})$`), 'container'],
  ['GET', /^\/images\/(.+)\/json$/, 'image'],
  ['POST', /^\/images\/create$/, 'pull'],
];

/** The only route that may switch protocols (the attach stream). Every other request is sent upstream with `Connection: close`. */
export const UPGRADE_ROUTE = new RegExp(`^/containers/${ID}/attach$`);

/** HostConfig fields the worker never sets. Present at all (even empty) means refused: an empty MaskedPaths unmasks /proc. */
const FORBIDDEN_HOST_CONFIG = [
  'Privileged', 'PidMode', 'IpcMode', 'UsernsMode', 'UTSMode', 'CgroupnsMode', 'Cgroup', 'CgroupParent', 'CapAdd', 'Devices',
  'DeviceRequests', 'DeviceCgroupRules', 'Mounts', 'VolumesFrom', 'Links', 'MaskedPaths', 'ReadonlyPaths', 'Sysctls', 'GroupAdd',
  'PortBindings', 'PublishAllPorts', 'OomKillDisable', 'VolumeDriver', 'ExtraHosts', 'Dns', 'DnsOptions', 'DnsSearch',
];

/** Set to anything but null/false/'' counts, including an empty array or object. */
const present = (v) => v !== undefined && v !== null && v !== false && v !== '';

/** The request path without the API version prefix (`/v1.43/containers/json` -> `/containers/json`) and query. */
export const cleanPath = (url) => (url.split('?')[0] ?? '').replace(/^\/v\d+(\.\d+)?(?=\/)/, '');

/** `name` -> `name:latest`, so `img` and `img:latest` compare equal. Digests and explicit tags are kept as they are. */
export function normaliseImage(ref) {
  const s = String(ref ?? '').trim();
  if (!s) return '';
  if (s.includes('@')) return s;
  const last = s.slice(s.lastIndexOf('/') + 1);
  return last.includes(':') ? s : `${s}:latest`;
}

const imageAllowed = (ref, images) => images.length > 0 && images.map(normaliseImage).includes(normaliseImage(ref));

/** True only for a numeric, non-root `uid:gid` (the worker sends `1000:1000`). `00`, `+0`, `root` and names are all refused. */
export function nonRootUser(user) {
  const m = /^(\d+):(\d+)$/.exec(String(user ?? ''));
  return !!m && Number(m[1]) > 0 && Number(m[2]) > 0;
}

/**
 * Null when a request is allowed, else why not. On success `route` tells the server what else to do:
 * `{ kind: 'container', id }` (check the label first) or `{ kind: 'list' }` (force the label filter). Kept synchronous so it is easy to test.
 */
export function classify(method, url, body, opts = {}) {
  const p = cleanPath(url);
  for (const [m, re, kind] of ALLOWED) {
    if (m !== method) continue;
    const match = re.exec(p);
    if (!match) continue;
    if (kind === 'create') {
      const why = checkCreate(body, opts);
      return why ? { why } : { route: { kind } };
    }
    if (kind === 'image') {
      let name;
      try { name = decodeURIComponent(match[1]); } catch { return { why: 'the image name is not valid' }; }
      return imageAllowed(name, opts.images ?? []) ? { route: { kind } } : { why: `image ${name} is not the agent image` };
    }
    if (kind === 'pull') {
      const why = checkPull(url, opts);
      return why ? { why } : { route: { kind } };
    }
    if (kind === 'container') return { route: { kind, id: match[1] } };
    return { route: { kind } };
  }
  return { why: `${method} ${p} is not allowed` };
}

/** Kept for callers and tests that only need a yes/no on the method, path and create body. */
export function checkRequest(method, url, createBody, opts = {}) {
  return classify(method, url, createBody, opts).why ?? null;
}

export function checkPull(url, { images = [] } = {}) {
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  // fromSrc imports a tarball from a URL or the request body: never what the worker does.
  for (const k of ['fromSrc', 'repo', 'changes']) if (q.has(k)) return `image import (${k}) is not allowed`;
  const from = q.get('fromImage') ?? '';
  const tag = q.get('tag') ?? '';
  if (!from) return 'fromImage is required';
  const ref = tag ? (tag.startsWith('sha256:') ? `${from}@${tag}` : `${from}:${tag}`) : from;
  return imageAllowed(ref, images) ? null : `image ${ref} is not the agent image`;
}

export function checkCreate(body, { bindRoots = [], volumePrefix = 'sdlc_', networks = ['sdlc_agent_net'], images = [] } = {}) {
  if (!body || typeof body !== 'object') return 'the create request has no JSON body';
  const hc = body.HostConfig ?? {};
  if (!imageAllowed(body.Image, images)) return `image ${body.Image ?? '(none)'} is not the agent image`;
  if (body.Labels?.[AGENT_LABEL_KEY] !== AGENT_LABEL_VALUE) return `the container must carry the label ${AGENT_LABEL_KEY}=${AGENT_LABEL_VALUE}`;
  for (const k of FORBIDDEN_HOST_CONFIG) if (k in hc && present(hc[k])) return `HostConfig.${k} is not allowed`;
  if (hc.Runtime && !['runsc', 'sysbox-runc', 'runc'].includes(hc.Runtime)) return `runtime ${hc.Runtime} is not allowed`;

  // The sandbox the worker always asks for is required, so a create that leaves it out is refused rather than trusted.
  if (!(hc.CapDrop ?? []).some((c) => String(c).toUpperCase() === 'ALL')) return 'CapDrop must include ALL';
  const secOpts = hc.SecurityOpt ?? [];
  for (const opt of secOpts) if (!/^no-new-privileges(:true)?$/.test(opt)) return `SecurityOpt ${opt} is not allowed`;
  if (!secOpts.some((o) => /^no-new-privileges(:true)?$/.test(o))) return 'SecurityOpt must include no-new-privileges';
  if (hc.ReadonlyRootfs !== true) return 'ReadonlyRootfs must be true';
  if (!(Number(hc.Memory) > 0)) return 'a memory limit is required';
  if (!(Number(hc.PidsLimit) > 0)) return 'a PID limit is required';
  if (!nonRootUser(body.User)) return 'containers must run as a numeric non-root uid:gid';
  if (body.Domainname || body.Volumes) return 'unexpected volume or domain settings';

  const net = hc.NetworkMode ?? '';
  if (!networks.includes(net)) return `the network ${net || '(default)'} is not allowed`;
  // Docker attaches every network named here as well as NetworkMode: only the same one is accepted.
  for (const name of Object.keys(body.NetworkingConfig?.EndpointsConfig ?? {})) if (name !== net) return `the network ${name} is not allowed`;

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

/** GET /containers/json with the agent label filter added, so the list never shows other containers on the host. */
export function forceLabelFilter(url) {
  const [p, q = ''] = url.split('?');
  const params = new URLSearchParams(q);
  let filters = {};
  try { filters = JSON.parse(params.get('filters') || '{}') ?? {}; } catch { filters = {}; }
  const labels = Array.isArray(filters.label) ? filters.label : Object.keys(filters.label ?? {});
  filters.label = [...new Set([...labels, `${AGENT_LABEL_KEY}=${AGENT_LABEL_VALUE}`])];
  params.set('filters', JSON.stringify(filters));
  return `${p}?${params.toString()}`;
}
