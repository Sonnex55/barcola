import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const databaseFile = path.join(process.cwd(), 'data', 'db.json');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function seedDatabase() {
  const timestamp = new Date().toISOString();
  return {
    users: [
      {
        id: 'usr_admin',
        firstName: 'System',
        lastName: 'Administrator',
        email: 'admin@hormans.demo',
        role: 'admin',
        password: hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'Admin123!'),
        status: 'active',
        currency: 'USD',
        createdAt: timestamp,
      },
      {
        id: 'usr_customer',
        firstName: 'Jordan',
        lastName: 'Davis',
        email: 'jordan@example.com',
        role: 'customer',
        password: hashPassword(process.env.DEMO_CUSTOMER_PASSWORD || 'Customer123!'),
        status: 'active',
        currency: 'USD',
        createdAt: timestamp,
      },
    ],
    balances: { usr_admin: 0, usr_customer: 4250.75 },
    ledger: [
      {
        id: 'txn_welcome',
        userId: 'usr_customer',
        type: 'credit',
        amount: 4250.75,
        description: 'Demo opening balance',
        reference: 'DEMO-OPEN-001',
        createdAt: timestamp,
        actor: 'system',
      },
    ],
    audit: [],
  };
}

function loadDatabase() {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

  try {
    return JSON.parse(fs.readFileSync(databaseFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    const database = seedDatabase();
    fs.writeFileSync(databaseFile, JSON.stringify(database, null, 2), { mode: 0o600 });
    return database;
  }
}

if (!globalThis.__hfiStore) {
  globalThis.__hfiStore = { db: loadDatabase(), sessions: new Map() };
}

const { db, sessions } = globalThis.__hfiStore;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function saveDatabase() {
  fs.writeFileSync(databaseFile, JSON.stringify(db, null, 2), { mode: 0o600 });
}

function publicUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    status: user.status,
    currency: user.currency || 'USD',
    balance: Number(db.balances[user.id] || 0),
    createdAt: user.createdAt,
  };
}

function json(status, data) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function verifyPassword(password, record) {
  const candidate = crypto.scryptSync(password, record.salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(record.hash, 'hex'));
}

async function readBody(request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > 1e6) {
    throw new RequestError(413, 'Request too large.');
  }
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestError(400, 'Invalid JSON request body.');
  }
}

function authorize(request, adminOnly = false) {
  const token = request.cookies.get('hfi_session')?.value;
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    return { response: json(401, { error: 'Please sign in to continue.' }) };
  }

  const user = db.users.find(
    (entry) => entry.id === session.userId && entry.status === 'active',
  );
  if (!user) {
    return { response: json(401, { error: 'Please sign in to continue.' }) };
  }
  if (adminOnly && user.role !== 'admin') {
    return { response: json(403, { error: 'Administrator permission required.' }) };
  }

  return { user };
}

function addAudit(actor, action, details) {
  db.audit.unshift({
    id: crypto.randomUUID(),
    actor,
    action,
    details,
    createdAt: new Date().toISOString(),
  });
}

function addLedger(userId, type, amount, description, actor) {
  db.ledger.unshift({
    id: crypto.randomUUID(),
    userId,
    type,
    amount,
    description,
    reference: `HFI-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
    actor,
    createdAt: new Date().toISOString(),
  });
}

function sessionResponse(user, status) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId: user.id,
    expires: Date.now() + 8 * 60 * 60 * 1000,
  });
  const response = json(status, { user: publicUser(user) });
  response.cookies.set('hfi_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return response;
}

async function handle(request) {
  const { pathname } = new URL(request.url);
  const route = pathname.startsWith('/api/') ? pathname.slice('/api/'.length) : '';
  const method = request.method;

  try {
    if (method === 'GET' && route === 'health') {
      return json(200, {
        status: 'ok',
        service: "Horman's Financial Institute demo API",
        timestamp: new Date().toISOString(),
      });
    }

    if (method === 'POST' && route === 'register') {
      const data = (await readBody(request)) || {};
      const firstName = String(data.firstName || '').trim();
      const lastName = String(data.lastName || '').trim();
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');

      if (!firstName || !lastName || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
        return json(400, {
          error: 'Enter your name, a valid email and a password of at least 10 characters.',
        });
      }
      if (db.users.some((user) => user.email === email)) {
        return json(409, { error: 'An account with this email already exists.' });
      }

      const user = {
        id: `usr_${crypto.randomUUID()}`,
        firstName,
        lastName,
        email,
        role: 'customer',
        password: hashPassword(password),
        status: 'active',
        currency: 'USD',
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
      db.balances[user.id] = 0;
      addAudit(user.id, 'account_registered', { email });
      saveDatabase();
      return sessionResponse(user, 201);
    }

    if (method === 'POST' && route === 'login') {
      const data = (await readBody(request)) || {};
      const email = String(data.email || '').trim().toLowerCase();
      const user = db.users.find((entry) => entry.email === email);
      if (!user || !verifyPassword(String(data.password || ''), user.password)) {
        return json(401, { error: 'Email or password is incorrect.' });
      }
      if (user.status !== 'active') {
        return json(403, {
          error: 'This account is currently restricted. Please contact customer service.',
        });
      }
      return sessionResponse(user, 200);
    }

    if (method === 'POST' && route === 'logout') {
      const token = request.cookies.get('hfi_session')?.value;
      if (token) {
        sessions.delete(token);
      }
      const response = json(200, { message: 'Signed out.' });
      response.cookies.set('hfi_session', '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
      return response;
    }

    if (method === 'GET' && route === 'me') {
      const authorization = authorize(request);
      return authorization.response || json(200, { user: publicUser(authorization.user) });
    }

    if (method === 'GET' && route === 'transactions') {
      const authorization = authorize(request);
      if (authorization.response) {
        return authorization.response;
      }
      return json(200, {
        transactions: db.ledger
          .filter((entry) => entry.userId === authorization.user.id)
          .slice(0, 100),
      });
    }

    if (method === 'POST' && route === 'withdrawals') {
      const authorization = authorize(request);
      if (authorization.response) {
        return authorization.response;
      }
      const user = authorization.user;
      const data = (await readBody(request)) || {};
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
        return json(400, { error: 'Enter a valid withdrawal amount.' });
      }
      if (amount > Number(db.balances[user.id] || 0)) {
        return json(400, {
          error: 'The requested amount exceeds the available demo balance.',
        });
      }

      const withdrawal = {
        id: crypto.randomUUID(),
        userId: user.id,
        type: 'withdrawal',
        amount,
        status: 'pending',
        description: 'Withdrawal request — pending review',
        reference: `HFI-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        actor: user.id,
        createdAt: new Date().toISOString(),
      };
      db.ledger.unshift(withdrawal);
      addAudit(user.id, 'withdrawal_request_pending', {
        withdrawalId: withdrawal.id,
        amount,
        status: 'pending',
      });
      saveDatabase();
      return json(201, {
        withdrawal: {
          id: withdrawal.id,
          amount,
          status: 'pending',
          reference: withdrawal.reference,
          createdAt: withdrawal.createdAt,
        },
        message:
          'Your withdrawal request has been received and is pending review. For assistance, please contact Horman@hormansfinancialinstitute.com.',
        supportEmail: 'Horman@hormansfinancialinstitute.com',
      });
    }

    if (method === 'POST' && route === 'transfers') {
      const authorization = authorize(request);
      if (authorization.response) {
        return authorization.response;
      }
      return json(503, {
        error: 'Transfers are not enabled in this demonstration. No funds have moved.',
      });
    }

    if (method === 'GET' && route === 'admin/customers') {
      const authorization = authorize(request, true);
      if (authorization.response) {
        return authorization.response;
      }
      return json(200, {
        customers: db.users.filter((user) => user.role === 'customer').map(publicUser),
      });
    }

    if (method === 'POST' && route === 'admin/balance-adjustments') {
      const authorization = authorize(request, true);
      if (authorization.response) {
        return authorization.response;
      }
      const admin = authorization.user;
      const data = (await readBody(request)) || {};
      const target = db.users.find(
        (user) => user.id === data.userId && user.role === 'customer',
      );
      const amount = Number(data.amount);
      const reason = String(data.reason || '').trim();
      const direction = data.direction === 'debit' ? 'debit' : 'credit';

      if (!target) {
        return json(404, { error: 'Customer not found.' });
      }
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || reason.length < 5) {
        return json(400, {
          error: 'Enter a valid amount and an adjustment reason of at least 5 characters.',
        });
      }
      if (direction === 'debit' && Number(db.balances[target.id] || 0) < amount) {
        return json(400, { error: 'Adjustment exceeds the available demo balance.' });
      }

      db.balances[target.id] = Number(
        (Number(db.balances[target.id] || 0) + (direction === 'credit' ? amount : -amount))
          .toFixed(2),
      );
      addLedger(target.id, direction, amount, `Admin adjustment: ${reason}`, admin.id);
      addAudit(admin.id, 'customer_balance_adjustment', {
        customerId: target.id,
        amount,
        direction,
        reason,
      });
      saveDatabase();
      return json(200, {
        customer: publicUser(target),
        message: 'Adjustment recorded successfully.',
      });
    }

    if (method === 'POST' && route === 'admin/customer-status') {
      const authorization = authorize(request, true);
      if (authorization.response) {
        return authorization.response;
      }
      const data = (await readBody(request)) || {};
      const target = db.users.find(
        (user) => user.id === data.userId && user.role === 'customer',
      );
      if (!target || !['active', 'suspended'].includes(data.status)) {
        return json(400, { error: 'Invalid customer or status.' });
      }
      target.status = data.status;
      addAudit(authorization.user.id, 'customer_status_changed', {
        customerId: target.id,
        status: target.status,
      });
      saveDatabase();
      return json(200, { customer: publicUser(target) });
    }

    if (method === 'GET' && route === 'admin/audit') {
      const authorization = authorize(request, true);
      if (authorization.response) {
        return authorization.response;
      }
      return json(200, { audit: db.audit.slice(0, 200) });
    }

    return json(404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof RequestError) {
      return json(error.status, { error: error.message });
    }
    console.error(error);
    return json(500, { error: 'An unexpected server error occurred.' });
  }
}

export const GET = handle;
export const POST = handle;
