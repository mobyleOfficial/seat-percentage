import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFixtureHtml } from './test-harness.mjs';
import { handleSessionsApi } from './seat-fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function handleRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  if (pathname === '/' || pathname === '') {
    return send(res, 200, 'text/html; charset=utf-8', '<!doctype html><title>isp-fixture</title>');
  }

  if (pathname.startsWith('/filme/')) {
    return send(res, 200, 'text/html; charset=utf-8', loadFixtureHtml());
  }

  if (pathname.startsWith('/v1/sessions/')) {
    const { status, body } = handleSessionsApi(pathname);
    return send(res, status, 'application/json', body);
  }

  send(res, 404, 'text/plain', 'not found');
}

/** @returns {Promise<{ origin: string, movieUrl: string, close: () => Promise<void> }>} */
export async function startFixtureServer() {
  const server = http.createServer(handleRequest);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    movieUrl: `${origin}/filme/homem-aranha-um-novo-dia?city=sao-paulo`,
    close: () => new Promise((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    }),
  };
}

/**
 * Build a Firefox test extension that injects on localhost (no port in matches —
 * Firefox ignores ports in match patterns) and rewrites the sessions API URL to
 * the local fixture server.
 */
export function prepareFirefoxTestExtension(serverOrigin) {
  const extDir = path.join(ROOT, '.test-extension-firefox');
  fs.rmSync(extDir, { recursive: true, force: true });
  fs.mkdirSync(extDir, { recursive: true });

  const packagePaths = [
    'inpage.css',
    'icons',
    'lib',
  ];

  for (const rel of packagePaths) {
    fs.cpSync(path.join(ROOT, rel), path.join(extDir, rel), { recursive: true });
  }

  let inpage = fs.readFileSync(path.join(ROOT, 'inpage.js'), 'utf8');
  inpage = inpage.replaceAll(
    'https://api.ingresso.com/v1/sessions',
    `${serverOrigin}/v1/sessions`,
  );
  fs.writeFileSync(path.join(extDir, 'inpage.js'), inpage);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

  // Firefox does not support ports in match patterns — omit the port.
  const localhostFilme = 'http://127.0.0.1/filme/*';
  manifest.host_permissions = [
    ...(manifest.host_permissions || []),
    'http://127.0.0.1/*',
  ];
  for (const script of manifest.content_scripts || []) {
    script.matches = [...new Set([...(script.matches || []), localhostFilme])];
  }

  fs.writeFileSync(path.join(extDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return extDir;
}
