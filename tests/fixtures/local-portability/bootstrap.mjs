// Only this test process: public package entrypoints resolve to current source,
// not potentially stale dist. Native Node 24 type stripping; no build/install.
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
const root = new URL('../../../', import.meta.url);
const src = new URL('src/', root).href;
const blocked = name => () => { throw new Error(`LOCAL_PORTABILITY_NETWORK_DENIED:${name}`); };
// Block both HTTP clients and lower-level sockets, including loopback. No
// agent process is spawned: the real SDK uses paired in-memory byte streams.
net.Socket.prototype.connect = blocked('net.connect');
net.Server.prototype.listen = blocked('net.listen');
net.connect = net.createConnection = blocked('net.connect');
tls.connect = blocked('tls.connect');
http.request = http.get = https.request = https.get = blocked('http');
dgram.createSocket = blocked('dgram');
for (const target of [dns, dnsPromises]) for (const name of Object.keys(target)) {
  if (/^(lookup|resolve|reverse)/.test(name) && typeof target[name] === 'function') target[name] = blocked(`dns.${name}`);
}
globalThis.fetch = blocked('fetch');
globalThis.WebSocket = class { constructor() { throw new Error('LOCAL_PORTABILITY_NETWORK_DENIED:WebSocket'); } };
syncBuiltinESMExports();
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@openma/common/local-runtime' || specifier === '@openma/common/acp-runtime') {
      return next(new URL(`src/${specifier.split('/').at(-1)}/index.ts`, root).href, context);
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith(src) && specifier.endsWith('.js')) {
      const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
    return next(specifier, context);
  },
});
// macOS may synthesize this noncredential variable during process startup.
delete process.env.__CF_USER_TEXT_ENCODING;
await import('./scenario.mjs');
