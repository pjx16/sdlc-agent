import { createSign } from 'node:crypto';

const b64 = (v: object | Buffer): string => Buffer.from(v instanceof Buffer ? v : JSON.stringify(v)).toString('base64url');

/** The short-lived JWT a GitHub App signs to talk to the GitHub API as the App (RS256, 10 minutes at most). */
export function appJwt(appId: string, privateKeyPem: string, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000) - 60; // GitHub asks for a little slack for clock drift
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat, exp: iat + 9 * 60, iss: appId })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem);
  return `${unsigned}.${b64(signature)}`;
}
