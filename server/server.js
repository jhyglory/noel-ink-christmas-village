'use strict';

// Tree Pick: single-process, file-backed development server.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.TREEPICK_DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'treepick.json');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 32 * 1024;
const MAX_WS_MESSAGE = 4096;
const ROOM_LIMIT = 12;
const LETTER_LIMIT = 500;
const REPLY_LIMIT = 50;
const STAGES = new Set(['first-snow', 'winter-forest', 'christmas-night']);
const LEADERBOARD_LIMIT = 50;
const PEER_TTL = 45_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
let state = { version: 1, rooms: {}, letters: [], leaderboard: {} };
let writeQueue = Promise.resolve();
let apiQueue = Promise.resolve();
let tokenSecret;
const sockets = new Map(); // room code -> Set<WebSocket>
const rate = new Map();

function token() { return crypto.randomBytes(32).toString('base64url'); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
// A prototype replay key. Keep it separate from the data file; loss of this key
// prevents reconstructing responses to earlier idempotent requests.
function derivedToken(purpose, key) { return crypto.createHmac('sha256', tokenSecret).update(purpose + '\0' + key).digest('base64url'); }
function expiry(createdAt) { const value = new Date(createdAt); value.setUTCFullYear(value.getUTCFullYear() + 1); return value.toISOString(); }
function letterState(letter) {
  if (letter.status === 'deleted') return 'deleted';
  if (letter.status === 'expired' || Date.now() >= Date.parse(letter.expiresAt || expiry(letter.createdAt))) return 'expired';
  return 'active';
}
function ensureActive(res, letter) {
  const status = letterState(letter);
  if (status === 'deleted') { fail(res, 410, '삭제된 편지입니다.'); return false; }
  if (status === 'expired') { fail(res, 410, '보관 기간이 지난 편지입니다.'); return false; }
  return true;
}
function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function code() {
  let result;
  do {
    result = Array.from(crypto.randomBytes(6), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  } while (state.rooms[result]);
  return result;
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function fail(res, status, message) { json(res, status, { error: message }); }
function limit(key, count, duration) {
  const time = Date.now();
  let entry = rate.get(key);
  if (!entry || entry.until <= time) { entry = { n: 0, until: time + duration }; rate.set(key, entry); }
  entry.n++;
  return entry.n <= count;
}
async function save() {
  // Snapshot synchronously, serialize writes, then atomically replace the file.
  const snapshot = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    const temporary = DATA_FILE + '.tmp';
    await fsp.writeFile(temporary, snapshot, { mode: 0o600 });
    await fsp.rename(temporary, DATA_FILE);
  });
  return writeQueue;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { chunks = []; reject(Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 })); req.resume(); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch { reject(Object.assign(new Error('올바른 JSON을 보내 주세요.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function findMember(rawToken, room) {
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  const digest = hash(rawToken);
  return room.members.find(member => member.tokenHash === digest) || null;
}
function bearer(req) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
  return match ? match[1] : '';
}
function appearance(value) {
  return /^[a-z0-9_-]{1,24}$/i.test(value || '') ? value : 'rabbit';
}
function publicLetter(letter) {
  return { id: letter.id, sender: letter.sender, recipient: letter.recipient, text: letter.text, paper: letter.paper || 'cream', stamp: letter.stamp || 'tree', createdAt: letter.createdAt, expiresAt: letter.expiresAt || expiry(letter.createdAt), replies: letter.replies.map(({ id, author, text, createdAt }) => ({ id, author, text, createdAt })) };
}
function roomView(room, member) {
  return { code: room.code, name: room.name, createdAt: room.createdAt, member: memberView(member) };
}
function memberView(member) { return { id: member.id, nickname: member.nickname, isOwner: member.isOwner, appearance: member.appearance || 'rabbit' }; }
function letterView(letter, member) {
  return { id: letter.id, authorId: letter.authorId, author: letter.author, text: letter.text, createdAt: letter.createdAt, canDelete: member.isOwner || member.id === letter.authorId, replies: letter.replies.map(reply => ({ id: reply.id, authorId: reply.authorId, author: reply.author, text: reply.text, createdAt: reply.createdAt })) };
}
function send(ws, message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function broadcast(roomCode, message, except) {
  for (const client of sockets.get(roomCode) || []) if (client !== except) send(client, message);
}
function roster(roomCode) {
  const unique = new Map();
  for (const ws of sockets.get(roomCode) || []) if (ws.member) unique.set(ws.member.id, { ...memberView(ws.member), x: ws.x, y: ws.y });
  return [...unique.values()];
}
function broadcastRoster(roomCode) { broadcast(roomCode, { type: 'roster', members: roster(roomCode) }); }
function mutation(room, type, detail) { broadcast(room.code, { type, ...detail }); }
async function api(req, res, pathname, clientIp) {
  const parts = pathname.split('/').filter(Boolean);
  if (!limit(`http:${clientIp}`, 300, 60_000)) {
    if (parts[1] === 'v1') return json(res, 429, { error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, requestId: id() });
    return fail(res, 429, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (parts[1] === 'v1') {
    const requestId = id();
    if (pathname === '/api/v1/community-tree' && req.method === 'GET') return json(res, 200, { data: state.communityTree, requestId });
    if (parts.length === 5 && parts[2] === 'letters' && parts[3] === 'read' && req.method === 'GET') {
      const raw = parts[4];
      const letter = /^[A-Za-z0-9_-]{43}$/.test(raw) && state.letters.find(item => item.readHash === hash(raw));
      if (!letter) return json(res, 404, { error: { code: 'LETTER_NOT_FOUND', message: '편지를 찾을 수 없습니다.' }, requestId });
      const status = letterState(letter);
      if (status !== 'active') return json(res, 410, { error: { code: status === 'deleted' ? 'LETTER_DELETED' : 'LETTER_EXPIRED', message: status === 'deleted' ? '삭제된 편지입니다.' : '보관 기간이 지난 편지입니다.' }, requestId });
      return json(res, 200, { data: { id: letter.id, recipientName: letter.recipient, body: letter.text, stationeryId: letter.paper || 'cream', sealId: letter.stamp || 'tree', createdAt: letter.createdAt, expiresAt: letter.expiresAt || expiry(letter.createdAt) }, requestId });
    }
    return json(res, 501, { error: { code: 'SERVICE_LIMITED', message: '이 기능은 기술 상세 승인 후 제공됩니다.' }, requestId });
  }
  if (parts.length === 2 && parts[1] === 'health' && req.method === 'GET') return json(res, 200, { ok: true });
  if (parts[1] === 'leaderboard') {
    const stageId = parts[2];
    if (parts.length !== 3 || !STAGES.has(stageId)) return fail(res, 404, '도안을 찾을 수 없습니다.');
    const entries = state.leaderboard[stageId] || [];
    if (req.method === 'GET') return json(res, 200, { stageId, entries });
    if (req.method !== 'POST') return fail(res, 405, '허용되지 않은 요청입니다.');
    if (!limit(`score:${clientIp}`, 60, 60 * 60_000)) return fail(res, 429, '기록을 너무 자주 등록하고 있어요.');
    const body = await readBody(req);
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 20 || /[\u0000-\u001F\u007F]/.test(body.name)) return fail(res, 400, '이름은 1자 이상 20자 이하로 입력해 주세요.');
    if (!Number.isInteger(body.moves) || body.moves < 1 || body.moves > 10000) return fail(res, 400, '이동 횟수는 1부터 10000까지의 정수여야 합니다.');
    entries.push({ name: body.name.trim(), moves: body.moves, createdAt: now() });
    // Stable sorting retains registration order when move counts are equal.
    entries.sort((a, b) => a.moves - b.moves);
    state.leaderboard[stageId] = entries.slice(0, LEADERBOARD_LIMIT);
    await save();
    return json(res, 201, { stageId, entries: state.leaderboard[stageId] });
  }
  if (parts[1] === 'letters') {
    if (parts.length === 2 && req.method === 'POST') {
      if (!limit(`standalone:${clientIp}`, 120, 60 * 60_000)) return fail(res, 429, '편지를 너무 자주 쓰고 있어요.');
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) return fail(res, 400, '유효한 중복 요청 방지 키가 필요합니다.');
      const body = await readBody(req);
      const sender = clean(body.sender, 24), recipient = clean(body.recipient, 24);
      if (typeof body.text !== 'string' || Array.from(body.text).length > 1000) return fail(res, 400, '편지는 1,000자 이내로 작성해 주세요.');
      const text = clean(body.text, 2000);
      if (!sender || !recipient || !text) return fail(res, 400, '보내는 사람, 받는 사람과 내용을 입력해 주세요.');
      if (body.paper && !['cream', 'snow', 'holly'].includes(body.paper)) return fail(res, 400, '사용할 수 없는 편지지입니다.');
      if (body.stamp && body.stamp !== 'tree') return fail(res, 400, '사용할 수 없는 인장입니다.');
      const paper = body.paper || 'cream', stamp = body.stamp || 'tree';
      const keyHash = hash(key);
      const requestHash = hash(JSON.stringify({ sender, recipient, text, paper, stamp }));
      const existing = state.letters.find(item => item.idempotencyHash === keyHash);
      if (existing) {
        if (existing.requestHash !== requestHash) return fail(res, 409, '같은 요청 키로 다른 내용을 저장할 수 없습니다.');
        if (!ensureActive(res, existing)) return;
        const readToken = derivedToken('read', key), manageToken = derivedToken('manage', key);
        if (hash(readToken) !== existing.readHash || hash(manageToken) !== existing.manageHash) return fail(res, 503, '기존 저장 결과를 복원할 수 없습니다.');
        return json(res, 200, { letter: publicLetter(existing), readToken, manageToken, duplicate: true });
      }
      const readToken = derivedToken('read', key), manageToken = derivedToken('manage', key);
      const createdAt = now();
      const letter = { id: id(), sender, recipient, text, paper, stamp, status: 'active', createdAt, expiresAt: expiry(createdAt), deletedAt: null, readHash: hash(readToken), manageHash: hash(manageToken), idempotencyHash: keyHash, requestHash, replies: [] };
      state.letters.push(letter);
      state.communityTree.letterCount += 1;
      state.communityTree.updatedAt = createdAt;
      await save();
      return json(res, 201, { letter: publicLetter(letter), readToken, manageToken });
    }
    // Capability tokens are unguessable and only hashes are persisted.
    const raw = parts[2];
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return fail(res, 404, '편지를 찾을 수 없습니다.');
    const digest = hash(raw);
    if (parts.length === 3 && req.method === 'DELETE') {
      const target = state.letters.find(item => item.manageHash === digest);
      if (!target) return fail(res, 404, '편지를 찾을 수 없습니다.');
      if (target.status !== 'deleted') { target.status = 'deleted'; target.deletedAt = now(); await save(); }
      return json(res, 200, { ok: true });
    }
    const letter = state.letters.find(item => item.readHash === digest);
    if (!letter) return fail(res, 404, '편지를 찾을 수 없습니다.');
    if (!ensureActive(res, letter)) return;
    if (parts.length === 3 && req.method === 'GET') return json(res, 200, { letter: publicLetter(letter) });
    if (parts.length === 4 && parts[3] === 'replies' && req.method === 'POST') {
      if (!limit(`standalone-reply:${clientIp}`, 50, 60 * 60_000)) return fail(res, 429, '답장을 너무 자주 쓰고 있어요.');
      const body = await readBody(req), author = clean(body.author, 24), text = clean(body.text, 2000);
      if (!author || !text) return fail(res, 400, '이름과 답장을 입력해 주세요.');
      if (letter.replies.length >= REPLY_LIMIT) return fail(res, 409, '이 편지에 더 이상 답장을 달 수 없습니다.');
      letter.replies.push({ id: id(), author, text, createdAt: now() });
      await save();
      return json(res, 201, { letter: publicLetter(letter) });
    }
    return fail(res, 404, '찾을 수 없습니다.');
  }
  if (parts[1] !== 'rooms') return fail(res, 404, '찾을 수 없습니다.');
  if (parts.length === 2 && req.method === 'POST') {
    if (!limit(`create:${clientIp}`, 12, 60 * 60_000)) return fail(res, 429, '방을 너무 많이 만들었습니다. 잠시 후 다시 시도해 주세요.');
    const body = await readBody(req), name = clean(body.name, 40), nickname = clean(body.nickname, 24);
    if (!name || !nickname) return fail(res, 400, '마을 이름과 닉네임을 입력해 주세요.');
    const secret = token(), roomCode = code();
    const owner = { id: id(), nickname, appearance: appearance(body.appearance), isOwner: true, tokenHash: hash(secret) };
    const room = { code: roomCode, name, createdAt: now(), members: [owner], letters: [] };
    state.rooms[roomCode] = room;
    await save();
    return json(res, 201, { room: roomView(room, owner), token: secret });
  }
  const room = state.rooms[(parts[2] || '').toUpperCase()];
  if (!room) return fail(res, 404, '마을을 찾을 수 없습니다.');
  if (parts.length === 4 && parts[3] === 'join' && req.method === 'POST') {
    if (!limit(`join:${clientIp}`, 120, 60 * 60_000)) return fail(res, 429, '입장 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    const body = await readBody(req), nickname = clean(body.nickname, 24);
    if (!nickname) return fail(res, 400, '닉네임을 입력해 주세요.');
    if (roster(room.code).length >= ROOM_LIMIT) return fail(res, 409, '지금 마을에 사람이 가득 찼어요. 잠시 후 다시 시도해 주세요.');
    const secret = token(), member = { id: id(), nickname, appearance: appearance(body.appearance), isOwner: false, tokenHash: hash(secret) };
    room.members.push(member);
    await save();
    return json(res, 201, { room: roomView(room, member), token: secret });
  }
  const member = findMember(bearer(req), room);
  if (!member) return fail(res, 401, '마을 입장이 필요합니다.');
  if (parts.length === 3 && req.method === 'GET') return json(res, 200, { room: roomView(room, member) });
  return fail(res, 404, '찾을 수 없습니다.');
}
async function staticFile(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '허용되지 않은 요청입니다.');
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return fail(res, 400, '잘못된 경로입니다.'); }
  if (decoded.includes('\0') || decoded.split('/').some(p => p.startsWith('.'))) return fail(res, 404, '찾을 수 없습니다.');
  const file = path.resolve(PUBLIC, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!file.startsWith(PUBLIC + path.sep)) return fail(res, 404, '찾을 수 없습니다.');
  try {
    const real = await fsp.realpath(file);
    if (!real.startsWith(PUBLIC + path.sep)) return fail(res, 404, '찾을 수 없습니다.');
    const stat = await fsp.stat(real);
    if (!stat.isFile()) return fail(res, 404, '찾을 수 없습니다.');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(real).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
  } catch { return fail(res, 404, '찾을 수 없습니다.'); }
}
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const action = apiQueue.then(async () => {
        const snapshot = structuredClone(state);
        try { return await api(req, res, url.pathname, ip); }
        catch (error) { state = snapshot; throw error; }
      });
      apiQueue = action.catch(() => {});
      return await action;
    }
    return await staticFile(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) return fail(res, error.status || 500, error.status ? error.message : '서버 오류가 발생했습니다.');
    res.destroy();
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE });
server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return socket.destroy(); }
  // Browsers send Origin; permit same-host connections only to avoid cross-site socket access.
  if (pathname !== '/ws' || (req.headers.origin && (() => { try { return new URL(req.headers.origin).host !== req.headers.host; } catch { return true; } })())) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  let authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
  ws.lastSeen = Date.now(); ws.x = 0.5; ws.y = 0.72; ws.lastMoveAt = Date.now(); ws.rateId = id();
  ws.on('pong', () => { ws.lastSeen = Date.now(); });
  ws.on('error', () => {});
  ws.on('message', data => {
    if (!limit(`ws:${ws.rateId}`, 1800, 60_000)) return ws.close(1008, 'Rate limit');
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    ws.lastSeen = Date.now();
    if (!ws.member) {
      if (message.type !== 'auth' || typeof message.code !== 'string') return ws.close(1008, 'Authentication required');
      const room = state.rooms[message.code.toUpperCase()];
      const member = room && findMember(message.token, room);
      if (!member) return ws.close(1008, 'Invalid credentials');
      const active = roster(room.code);
      if (active.length >= ROOM_LIMIT && !active.some(item => item.id === member.id)) {
        send(ws, { type: 'error', error: '지금 마을에 사람이 가득 찼어요. 잠시 후 다시 시도해 주세요.' });
        return ws.close(1008, 'Room full');
      }
      clearTimeout(authTimer); authTimer = null;
      ws.member = member; ws.roomCode = room.code;
      if (!sockets.has(room.code)) sockets.set(room.code, new Set());
      sockets.get(room.code).add(ws);
      send(ws, { type: 'welcome', member: memberView(member), members: roster(room.code) });
      broadcastRoster(room.code);
      return;
    }
    if (message.type === 'position') {
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y) || message.x < 0 || message.x > 1 || message.y < 0 || message.y > 1) return;
      // Prototype anti-teleport guard; production movement and frequency require approval.
      const time = Date.now(), allowance = 0.10 + Math.min(1, Math.max(0, time - ws.lastMoveAt) / 1000);
      if (Math.hypot(message.x - ws.x, message.y - ws.y) > allowance) return;
      ws.x = message.x; ws.y = message.y; ws.lastMoveAt = time;
      broadcast(ws.roomCode, { type: 'position', memberId: ws.member.id, x: ws.x, y: ws.y }, ws);
    } else if (message.type === 'wave' && limit(`wave:${ws.member.id}`, 20, 10_000)) {
      broadcast(ws.roomCode, { type: 'wave', memberId: ws.member.id });
    } else if (message.type === 'ping') send(ws, { type: 'pong' });
  });
  ws.on('close', () => {
    clearTimeout(authTimer);
    rate.delete(`ws:${ws.rateId}`);
    if (!ws.roomCode) return;
    const clients = sockets.get(ws.roomCode);
    clients?.delete(ws);
    if (!clients?.size) sockets.delete(ws.roomCode);
    else broadcastRoster(ws.roomCode);
  });
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (Date.now() - ws.lastSeen > PEER_TTL) ws.terminate();
    else if (ws.readyState === WebSocket.OPEN) ws.ping();
  }
  for (const [key, entry] of rate) if (entry.until <= Date.now()) rate.delete(key);
}, 20_000);
heartbeat.unref();
async function start() {
  await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    const parsed = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
    if (!parsed || parsed.version !== 1 || !parsed.rooms || typeof parsed.rooms !== 'object') throw new Error('Unsupported data format');
    state = parsed;
    if (!Array.isArray(state.letters)) state.letters = [];
    if (!state.leaderboard || typeof state.leaderboard !== 'object' || Array.isArray(state.leaderboard)) state.leaderboard = {};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const secretFile = path.join(DATA_DIR, 'replay-secret.key');
  try { tokenSecret = await fsp.readFile(secretFile); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (state.letters.some(letter => letter.idempotencyHash)) throw new Error('Replay secret is missing while idempotency records exist; restore the original secret.');
    const candidate = crypto.randomBytes(32);
    try { await fsp.writeFile(secretFile, candidate, { mode: 0o600, flag: 'wx' }); tokenSecret = candidate; }
    catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; tokenSecret = await fsp.readFile(secretFile); }
  }
  if (tokenSecret.length !== 32) throw new Error('Invalid replay secret');
  const fingerprint = hash(tokenSecret);
  if (state.replayKeyFingerprint && state.replayKeyFingerprint !== fingerprint) throw new Error('Replay secret does not match the data; restore the original secret.');
  state.replayKeyFingerprint = fingerprint;
  if (!state.communityTree || !Number.isSafeInteger(state.communityTree.letterCount)) {
    state.communityTree = { id: 'global', letterCount: new Set(state.letters.map(letter => letter.id)).size, updatedAt: now() };
  }
  server.listen(PORT, HOST, () => console.log(`Tree Pick listening on http://${HOST}:${PORT}`));
}
start().catch(error => { console.error('Failed to load Tree Pick data:', error); process.exitCode = 1; });
