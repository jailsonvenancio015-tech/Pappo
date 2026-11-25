import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

interface ServerAccount {
  handle: string;
  name: string;
  salt: string;
  passHash: string;
  recoveryKeyHash: string;
  recoveryCodeHashes: string[];
  verifiedContact: string;
  privateProfile: boolean;
  createdAt: number;
  backupCipher?: string;
}

interface UploadSession {
  uploadId: string;
  ownerHandle: string;
  fileName: string;
  mimeType: string;
  totalBytes: number;
  chunkSize: number;
  totalChunks: number;
  quality: string;
  keepOriginal: boolean;
  chunks: Map<number, Buffer>;
  createdAt: number;
}

interface StoredMedia {
  id: string;
  ownerHandle: string;
  mimeType: string;
  quality: string;
  bytes: number;
  buffer: Buffer;
  createdAt: number;
}

interface LivePeerInfo {
  nodeId: string;
  handle: string;
  label: string;
  rttMs: number;
  bandwidthMbps: number;
  batteryPct: number;
  charging: boolean;
  onCellular: boolean;
  saveData: boolean;
  thermalThrottled: boolean;
  availableSpaceMb: number;
  authorized: boolean;
  hasAssetIds: string[];
  lastSeen: number;
}

const RESERVED_HANDLES = new Set(['clara', 'lucas', 'marina', 'theo', 'admin', 'pappo', 'suporte']);
const accounts = new Map<string, ServerAccount>();
const uploadSessions = new Map<string, UploadSession>();
const recoveryMediaStore = new Map<string, StoredMedia>();
const reportsLog: Array<{ id: string; reporter: string; targetType: string; targetId: string; reason: string; t: number }> = [];
const activePeers = new Map<string, { ws: WebSocket; info: LivePeerInfo }>();
const channelHistory = new Map<string, unknown[]>();

// Technical log without private content
function techLog(event: string, meta: Record<string, string | number | boolean> = {}) {
  const safeMeta = Object.entries(meta)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  console.log(`[pappo-node] ${new Date().toISOString()} ${event} ${safeMeta}`);
}

// Rate limiter (per IP token bucket)
const rateBuckets = new Map<string, { tokens: number; updated: number }>();
function rateLimit(maxPerMin: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'local';
    const now = Date.now();
    const bucket = rateBuckets.get(ip) || { tokens: maxPerMin, updated: now };
    const elapsedMin = (now - bucket.updated) / 60_000;
    bucket.tokens = Math.min(maxPerMin, bucket.tokens + elapsedMin * maxPerMin);
    bucket.updated = now;
    if (bucket.tokens < 1) {
      res.status(429).json({ error: 'Muitas solicitações. Aguarde alguns segundos.' });
      return;
    }
    bucket.tokens -= 1;
    rateBuckets.set(ip, bucket);
    next();
  };
}

function hashSecret(secret: string, salt: string): string {
  return crypto.scryptSync(secret, salt, 32).toString('hex');
}

function verifySecret(secret: string, salt: string, expectedHex: string): boolean {
  const actual = Buffer.from(hashSecret(secret, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function signToken(handle: string): string {
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  const payload = Buffer.from(JSON.stringify({ h: handle, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { h: string; exp: number };
    if (!parsed.h || parsed.exp < Date.now()) return null;
    return parsed.h;
  } catch {
    return null;
  }
}

function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

function broadcastDirectory() {
  const now = Date.now();
  const list: LivePeerInfo[] = [];
  for (const [nodeId, entry] of activePeers.entries()) {
    if (entry.ws.readyState !== WebSocket.OPEN || now - entry.info.lastSeen > 60_000) {
      activePeers.delete(nodeId);
      continue;
    }
    list.push(entry.info);
  }
  const payload = JSON.stringify({ type: 'peer:directory', peers: list, serverTime: now });
  for (const entry of activePeers.values()) {
    if (entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(payload);
    }
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' }));
  app.use('/api', rateLimit(180));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      peersOnline: activePeers.size,
      recoveryAssets: recoveryMediaStore.size,
      uptimeSec: Math.round(process.uptime()),
    });
  });

  app.get('/api/handles/:handle/available', (req, res) => {
    const handle = normalizeHandle(req.params.handle || '');
    const valid = /^[a-z0-9_.]{3,20}$/.test(handle);
    if (!valid) {
      res.json({ available: false, reason: 'Formato inválido (3–20 letras, números, _ ou .)' });
      return;
    }
    const taken = RESERVED_HANDLES.has(handle) || accounts.has(handle);
    res.json({ available: !taken, handle });
  });

  app.post('/api/auth/signup', rateLimit(30), (req, res) => {
    const body = req.body as {
      handle?: string;
      name?: string;
      password?: string;
      privateProfile?: boolean;
      verifiedContact?: string;
    };
    const handle = normalizeHandle(body.handle || '');
    const name = (body.name || '').trim().slice(0, 40);
    const password = body.password || '';
    if (!/^[a-z0-9_.]{3,20}$/.test(handle) || RESERVED_HANDLES.has(handle) || accounts.has(handle)) {
      res.status(409).json({ error: 'Esse @ não está disponível.' });
      return;
    }
    if (name.length < 2 || password.length < 6) {
      res.status(400).json({ error: 'Nome e senha (mín. 6 caracteres) são obrigatórios.' });
      return;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const recoveryKey = `PAPPO-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const recoveryCodes = Array.from({ length: 6 }, () =>
      crypto.randomBytes(3).toString('hex').toUpperCase()
    );

    const account: ServerAccount = {
      handle,
      name,
      salt,
      passHash: hashSecret(password, salt),
      recoveryKeyHash: hashSecret(recoveryKey, salt),
      recoveryCodeHashes: recoveryCodes.map((c) => hashSecret(c, salt)),
      verifiedContact: (body.verifiedContact || '').trim().slice(0, 80),
      privateProfile: Boolean(body.privateProfile),
      createdAt: Date.now(),
    };
    accounts.set(handle, account);
    techLog('auth:signup', { handle, priv: account.privateProfile });

    res.status(201).json({
      token: signToken(handle),
      handle,
      recoveryKey,
      recoveryCodes,
    });
  });

  app.post('/api/auth/login', rateLimit(40), (req, res) => {
    const body = req.body as { handle?: string; password?: string };
    const handle = normalizeHandle(body.handle || '');
    const password = body.password || '';
    const acct = accounts.get(handle);
    if (!acct || !verifySecret(password, acct.salt, acct.passHash)) {
      res.status(401).json({ error: '@ ou senha incorretos.' });
      return;
    }
    techLog('auth:login', { handle });
    res.json({
      token: signToken(handle),
      handle: acct.handle,
      name: acct.name,
      privateProfile: acct.privateProfile,
    });
  });

  app.post('/api/auth/recover', rateLimit(20), (req, res) => {
    const body = req.body as { handle?: string; recoveryCredential?: string; newPassword?: string };
    const handle = normalizeHandle(body.handle || '');
    const cred = (body.recoveryCredential || '').trim().toUpperCase();
    const newPassword = body.newPassword || '';
    const acct = accounts.get(handle);

    if (!acct || !cred) {
      res.status(400).json({ error: 'Informe o @ e uma chave ou código de recuperação válido.' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    const keyMatch = verifySecret(cred, acct.salt, acct.recoveryKeyHash);
    const codeIndex = acct.recoveryCodeHashes.findIndex((h) => verifySecret(cred, acct.salt, h));

    if (!keyMatch && codeIndex < 0) {
      res.status(403).json({ error: 'Chave ou código de recuperação inválido.' });
      return;
    }

    if (codeIndex >= 0) {
      // Single-use recovery code consumed
      acct.recoveryCodeHashes.splice(codeIndex, 1);
    }
    acct.passHash = hashSecret(newPassword, acct.salt);
    techLog('auth:recover', { handle, method: keyMatch ? 'key' : 'one-time-code' });
    res.json({ ok: true, token: signToken(handle), remainingCodes: acct.recoveryCodeHashes.length });
  });

  app.put('/api/recovery/backup', (req, res) => {
    const handle = verifyToken(req.headers.authorization);
    if (!handle) {
      res.status(401).json({ error: 'Sessão não autenticada.' });
      return;
    }
    const acct = accounts.get(handle);
    const { backupCipher } = req.body as { backupCipher?: string };
    if (acct && typeof backupCipher === 'string' && backupCipher.length < 10_000_000) {
      acct.backupCipher = backupCipher;
    }
    res.json({ ok: true, savedAt: Date.now() });
  });

  app.get('/api/recovery/backup', (req, res) => {
    const handle = verifyToken(req.headers.authorization);
    if (!handle) {
      res.status(401).json({ error: 'Sessão não autenticada.' });
      return;
    }
    const acct = accounts.get(handle);
    res.json({ backupCipher: acct?.backupCipher || null });
  });

  // Resumable Chunked Upload + Recovery Media Storage
  app.post('/api/upload/init', (req, res) => {
    const handle = verifyToken(req.headers.authorization) || 'local';
    const body = req.body as {
      uploadId?: string;
      fileName?: string;
      mimeType?: string;
      totalBytes?: number;
      chunkSize?: number;
      quality?: string;
      keepOriginal?: boolean;
    };
    const uploadId = (body.uploadId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '');
    const totalBytes = Math.min(35_000_000, Math.max(1, Number(body.totalBytes || 1)));
    const chunkSize = Math.max(16_384, Number(body.chunkSize || 65_536));
    const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize));

    const existing = uploadSessions.get(uploadId);
    if (existing) {
      res.json({
        uploadId,
        uploadedChunks: [...existing.chunks.keys()].sort((a, b) => a - b),
        totalChunks: existing.totalChunks,
      });
      return;
    }

    uploadSessions.set(uploadId, {
      uploadId,
      ownerHandle: handle,
      fileName: String(body.fileName || 'midia').slice(0, 120),
      mimeType: String(body.mimeType || 'application/octet-stream').slice(0, 80),
      totalBytes,
      chunkSize,
      totalChunks,
      quality: String(body.quality || 'media'),
      keepOriginal: Boolean(body.keepOriginal),
      chunks: new Map(),
      createdAt: Date.now(),
    });

    res.status(201).json({ uploadId, uploadedChunks: [], totalChunks });
  });

  app.put('/api/upload/chunk/:uploadId/:index', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
    const { uploadId, index } = req.params;
    const session = uploadSessions.get(uploadId);
    const idx = Number(index);
    if (!session || !Number.isInteger(idx) || idx < 0 || idx >= session.totalChunks) {
      res.status(404).json({ error: 'Sessão de envio ou bloco inválido.' });
      return;
    }
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    session.chunks.set(idx, buf);
    res.json({
      uploadId,
      index: idx,
      received: session.chunks.size,
      totalChunks: session.totalChunks,
    });
  });

  app.get('/api/upload/status/:uploadId', (req, res) => {
    const session = uploadSessions.get(req.params.uploadId);
    if (!session) {
      res.status(404).json({ error: 'Envio não encontrado.' });
      return;
    }
    res.json({
      uploadId: session.uploadId,
      uploadedChunks: [...session.chunks.keys()].sort((a, b) => a - b),
      totalChunks: session.totalChunks,
    });
  });

  app.post('/api/upload/complete/:uploadId', (req, res) => {
    const session = uploadSessions.get(req.params.uploadId);
    if (!session) {
      res.status(404).json({ error: 'Envio não encontrado.' });
      return;
    }
    const ordered: Buffer[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      const part = session.chunks.get(i);
      if (!part) {
        res.status(409).json({ error: `Bloco ${i} pendente.`, missingIndex: i });
        return;
      }
      ordered.push(part);
    }
    const merged = Buffer.concat(ordered);
    const mediaId = `med_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    recoveryMediaStore.set(mediaId, {
      id: mediaId,
      ownerHandle: session.ownerHandle,
      mimeType: session.mimeType,
      quality: session.quality,
      bytes: merged.length,
      buffer: merged,
      createdAt: Date.now(),
    });
    uploadSessions.delete(session.uploadId);
    techLog('media:stored', { mediaId, bytes: merged.length, quality: session.quality });

    res.json({
      mediaId,
      url: `/api/media/${mediaId}`,
      bytes: merged.length,
      quality: session.quality,
    });
  });

  app.get('/api/media/:id', (req, res) => {
    const item = recoveryMediaStore.get(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Mídia temporariamente indisponível.' });
      return;
    }
    const total = item.buffer.length;
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', item.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        const start = Number(match[1]);
        const end = match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
        if (start < total && end >= start) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', String(end - start + 1));
          res.end(item.buffer.subarray(start, end + 1));
          return;
        }
      }
    }
    res.setHeader('Content-Length', String(total));
    res.end(item.buffer);
  });

  app.post('/api/reports', rateLimit(20), (req, res) => {
    const handle = verifyToken(req.headers.authorization) || 'anon';
    const body = req.body as { targetType?: string; targetId?: string; reason?: string };
    if (!body.targetType || !body.targetId || !body.reason) {
      res.status(400).json({ error: 'Dados da denúncia incompletos.' });
      return;
    }
    const entry = {
      id: `rep_${Date.now()}`,
      reporter: handle,
      targetType: String(body.targetType).slice(0, 20),
      targetId: String(body.targetId).slice(0, 80),
      reason: String(body.reason).slice(0, 120),
      t: Date.now(),
    };
    reportsLog.push(entry);
    techLog('safety:report', { type: entry.targetType, reason: entry.reason });
    res.status(201).json({ ok: true, id: entry.id });
  });

  // Serves compiled standalone JS + CSS shell so users can export a zero-server single-file local HTML app
  let cachedStandaloneBundle: { css: string; js: string } | null = null;
  app.get('/api/standalone-shell', rateLimit(10), async (_req, res) => {
    try {
      if (!cachedStandaloneBundle) {
        const distAssetsDir = path.resolve(process.cwd(), 'dist', 'assets');
        const readDistAssets = () => {
          if (!fs.existsSync(distAssetsDir)) return null;
          const files = fs.readdirSync(distAssetsDir);
          const jsFiles = files.filter((f) => f.endsWith('.js'));
          const cssFiles = files.filter((f) => f.endsWith('.css'));
          if (!jsFiles.length) return null;
          const js = jsFiles.map((f) => fs.readFileSync(path.join(distAssetsDir, f), 'utf8')).join('\n');
          const css = cssFiles.map((f) => fs.readFileSync(path.join(distAssetsDir, f), 'utf8')).join('\n');
          return { css, js };
        };

        let bundle = readDistAssets();
        if (!bundle) {
          const { build } = await import('vite');
          await build({ logLevel: 'silent' });
          bundle = readDistAssets();
        }
        if (bundle) cachedStandaloneBundle = bundle;
      }

      if (!cachedStandaloneBundle) {
        res.status(503).json({ error: 'Pacote standalone indisponível no momento.' });
        return;
      }
      res.json(cachedStandaloneBundle);
    } catch {
      res.status(500).json({ error: 'Falha ao montar aplicativo auto-contido.' });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let currentNodeId = '';

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        const type = String(msg.type || '');

        if (type === 'peer:announce' || type === 'peer:heartbeat') {
          const info = msg.info as LivePeerInfo | undefined;
          if (!info || !info.nodeId) return;
          currentNodeId = String(info.nodeId).slice(0, 64);
          activePeers.set(currentNodeId, {
            ws,
            info: {
              ...info,
              nodeId: currentNodeId,
              lastSeen: Date.now(),
            },
          });
          if (type === 'peer:announce') {
            ws.send(JSON.stringify({ type: 'peer:ack', nodeId: currentNodeId, serverTime: Date.now() }));
          }
          broadcastDirectory();
          return;
        }

        if (type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: msg.ts, serverTime: Date.now() }));
          return;
        }

        // WebRTC signaling relay
        if (type === 'rtc:offer' || type === 'rtc:answer' || type === 'rtc:ice') {
          const targetNodeId = String(msg.to || '');
          const target = activePeers.get(targetNodeId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({ ...msg, from: currentNodeId }));
          }
          return;
        }

        // Fallback relay for chat & mesh sync (never logs private message text)
        if (type === 'chat:send') {
          const threadId = String(msg.threadId || 'global');
          const message = msg.message as { id?: string; clientMsgId?: string } | undefined;
          if (!message) return;
          const history = channelHistory.get(threadId) || [];
          const key = message.clientMsgId || message.id;
          if (!history.some((x: unknown) => {
            const m = x as { id?: string; clientMsgId?: string };
            return (m.clientMsgId || m.id) === key;
          })) {
            history.push(message);
            if (history.length > 100) history.shift();
            channelHistory.set(threadId, history);
          }

          ws.send(JSON.stringify({ type: 'chat:ack', threadId, clientMsgId: message.clientMsgId || message.id }));
          const broadcast = JSON.stringify({ type: 'chat:event', threadId, message, from: currentNodeId });
          for (const [id, entry] of activePeers.entries()) {
            if (id !== currentNodeId && entry.ws.readyState === WebSocket.OPEN) {
              entry.ws.send(broadcast);
            }
          }
          return;
        }

        if (type === 'relay:asset:request') {
          const targetNodeId = String(msg.to || '');
          const target = activePeers.get(targetNodeId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({ ...msg, from: currentNodeId }));
          } else {
            ws.send(JSON.stringify({
              type: 'relay:asset:unavailable',
              requestId: msg.requestId,
              assetId: msg.assetId,
            }));
          }
          return;
        }

        if (type === 'relay:asset:response') {
          const targetNodeId = String(msg.to || '');
          const target = activePeers.get(targetNodeId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({ ...msg, from: currentNodeId }));
          }
        }
      } catch {
        // Ignore malformed payloads safely
      }
    });

    ws.on('close', () => {
      if (currentNodeId) {
        activePeers.delete(currentNodeId);
        broadcastDirectory();
      }
    });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    techLog('server:ready', { port: PORT, prod: IS_PROD });
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
