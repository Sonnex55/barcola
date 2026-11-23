'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const sessions = new Map();
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, record) {
  const candidate = crypto.scryptSync(password, record.salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(record.hash, 'hex'));
}
function now() { return new Date().toISOString(); }
function seed() {
  const adminPass = hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'Admin123!');
  const customerPass = hashPassword(process.env.DEMO_CUSTOMER_PASSWORD || 'Customer123!');
  return {
    users: [
      { id: 'usr_admin', firstName: 'System', lastName: 'Administrator', email: 'admin@hormans.demo', role: 'admin', password: adminPass, status: 'active', currency: 'USD', createdAt: now() },
      { id: 'usr_customer', firstName: 'Jordan', lastName: 'Davis', email: 'jordan@example.com', role: 'customer', password: customerPass, status: 'active', currency: 'USD', createdAt: now() }
    ],
    balances: { usr_admin: 0, usr_customer: 4250.75 },
    ledger: [{ id: 'txn_welcome', userId: 'usr_customer', type: 'credit', amount: 4250.75, description: 'Demo opening balance', reference: 'DEMO-OPEN-001', createdAt: now(), actor: 'system' }],
    audit: []
  };
}
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
catch { db = seed(); save(); }
function save() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), { mode: 0o600 }); }
function publicUser(user) {
  return { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, status: user.status, currency: user.currency || 'USD', balance: Number(db.balances[user.id] || 0), createdAt: user.createdAt };
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
function cookieToken(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|; )hfi_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
function auth(req) {
  const token = cookieToken(req); const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) return null;
  return db.users.find(u => u.id === session.userId && u.status === 'active') || null;
}
function requireAuth(req, res) {
  const user = auth(req); if (!user) { send(res, 401, { error: 'Please sign in to continue.' }); return null; } return user;
}
function requireAdmin(req, res) {
  const user = requireAuth(req, res); if (!user) return null;
  if (user.role !== 'admin') { send(res, 403, { error: 'Administrator permission required.' }); return null; } return user;
}
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw new Error('Request too large'); }
  return raw ? JSON.parse(raw) : {};
}
function addAudit(actor, action, details) { db.audit.unshift({ id: crypto.randomUUID(), actor, action, details, createdAt: now() }); }
function addLedger(userId, type, amount, description, actor) {
  db.ledger.unshift({ id: crypto.randomUUID(), userId, type, amount, description, reference: 'HFI-' + crypto.randomBytes(5).toString('hex').toUpperCase(), actor, createdAt: now() });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  if (req.method === 'GET' && route === '/api/health') return send(res, 200, { status: 'ok', service: "Horman's Financial Institute demo API", timestamp: now() });
  try {
    if (req.method === 'POST' && route === '/api/register') {
      const data = await body(req); const firstName = String(data.firstName || '').trim(); const lastName = String(data.lastName || '').trim(); const email = String(data.email || '').trim().toLowerCase(); const password = String(data.password || '');
      if (!firstName || !lastName || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) return send(res, 400, { error: 'Enter your name, a valid email and a password of at least 10 characters.' });
      if (db.users.some(u => u.email === email)) return send(res, 409, { error: 'An account with this email already exists.' });
      const user = { id: 'usr_' + crypto.randomUUID(), firstName, lastName, email, role: 'customer', password: hashPassword(password), status: 'active', currency: 'USD', createdAt: now() };
      db.users.push(user); db.balances[user.id] = 0; addAudit(user.id, 'account_registered', { email }); save();
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { userId: user.id, expires: Date.now() + 8 * 60 * 60 * 1000 });
      return send(res, 201, { user: publicUser(user) }, { 'Set-Cookie': `hfi_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` });
    }
    if (req.method === 'POST' && route === '/api/login') {
      const data = await body(req); const email = String(data.email || '').trim().toLowerCase(); const user = db.users.find(u => u.email === email);
      if (!user || !verifyPassword(String(data.password || ''), user.password)) return send(res, 401, { error: 'Email or password is incorrect.' });
      if (user.status !== 'active') return send(res, 403, { error: 'This account is currently restricted. Please contact customer service.' });
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { userId: user.id, expires: Date.now() + 8 * 60 * 60 * 1000 });
      return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': `hfi_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` });
    }
    if (req.method === 'POST' && route === '/api/logout') {
      const token = cookieToken(req); if (token) sessions.delete(token);
      return send(res, 200, { message: 'Signed out.' }, { 'Set-Cookie': 'hfi_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    if (req.method === 'GET' && route === '/api/me') { const user = requireAuth(req, res); if (!user) return; return send(res, 200, { user: publicUser(user) }); }
    if (req.method === 'GET' && route === '/api/transactions') {
      const user = requireAuth(req, res); if (!user) return;
      return send(res, 200, { transactions: db.ledger.filter(t => t.userId === user.id).slice(0, 100) });
    }
    if (req.method === 'POST' && route === '/api/withdrawals') {
      const user = requireAuth(req, res); if (!user) return;
      const data = await body(req); const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return send(res, 400, { error: 'Enter a valid withdrawal amount.' });
      if (amount > Number(db.balances[user.id] || 0)) return send(res, 400, { error: 'The requested amount exceeds the available demo balance.' });
      const withdrawal = {
        id: crypto.randomUUID(), userId: user.id, type: 'withdrawal', amount,
        status: 'pending', description: 'Withdrawal request — pending review',
        reference: 'HFI-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
        actor: user.id, createdAt: now()
      };
      db.ledger.unshift(withdrawal);
      addAudit(user.id, 'withdrawal_request_pending', { withdrawalId: withdrawal.id, amount, status: 'pending' });
      save();
      return send(res, 201, {
        withdrawal: { id: withdrawal.id, amount, status: 'pending', reference: withdrawal.reference, createdAt: withdrawal.createdAt },
        message: 'Your withdrawal request has been received and is pending review. For assistance, please contact Horman@hormansfinancialinstitute.com.',
        supportEmail: 'Horman@hormansfinancialinstitute.com'
      });
    }
    if (req.method === 'POST' && route === '/api/transfers') {
      const user = requireAuth(req, res); if (!user) return;
      return send(res, 503, { error: 'Transfers are not enabled in this demonstration. No funds have moved.' });
    }
    if (req.method === 'GET' && route === '/api/admin/customers') {
      const admin = requireAdmin(req, res); if (!admin) return;
      return send(res, 200, { customers: db.users.filter(u => u.role === 'customer').map(publicUser) });
    }
    if (req.method === 'POST' && route === '/api/admin/balance-adjustments') {
      const admin = requireAdmin(req, res); if (!admin) return;
      const data = await body(req); const target = db.users.find(u => u.id === data.userId && u.role === 'customer'); const amount = Number(data.amount); const reason = String(data.reason || '').trim(); const direction = data.direction === 'debit' ? 'debit' : 'credit';
      if (!target) return send(res, 404, { error: 'Customer not found.' });
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || reason.length < 5) return send(res, 400, { error: 'Enter a valid amount and an adjustment reason of at least 5 characters.' });
      if (direction === 'debit' && Number(db.balances[target.id] || 0) < amount) return send(res, 400, { error: 'Adjustment exceeds the available demo balance.' });
      db.balances[target.id] = Number((Number(db.balances[target.id] || 0) + (direction === 'credit' ? amount : -amount)).toFixed(2));
      addLedger(target.id, direction, amount, `Admin adjustment: ${reason}`, admin.id); addAudit(admin.id, 'customer_balance_adjustment', { customerId: target.id, amount, direction, reason }); save();
      return send(res, 200, { customer: publicUser(target), message: 'Adjustment recorded successfully.' });
    }
    if (req.method === 'POST' && route === '/api/admin/customer-status') {
      const admin = requireAdmin(req, res); if (!admin) return;
      const data = await body(req); const target = db.users.find(u => u.id === data.userId && u.role === 'customer');
      if (!target || !['active', 'suspended'].includes(data.status)) return send(res, 400, { error: 'Invalid customer or status.' });
      target.status = data.status; addAudit(admin.id, 'customer_status_changed', { customerId: target.id, status: target.status }); save(); return send(res, 200, { customer: publicUser(target) });
    }
    if (req.method === 'GET' && route === '/api/admin/audit') { const admin = requireAdmin(req, res); if (!admin) return; return send(res, 200, { audit: db.audit.slice(0, 200) }); }

    // Serve the frontend and static assets.
    let file = route === '/' ? 'index.html' : decodeURIComponent(route.slice(1));
    const full = path.resolve(ROOT, file);
    if (!full.startsWith(ROOT + path.sep) && full !== path.join(ROOT, 'index.html')) return send(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(full); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); fs.createReadStream(full).pipe(res);
  } catch (error) { console.error(error); send(res, 500, { error: 'An unexpected server error occurred.' }); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Horman's Financial Institute running at http://localhost:${PORT}`));
