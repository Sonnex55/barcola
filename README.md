# Horman's Financial Institute — Next.js demonstration

A responsive banking UI with a Next.js frontend and API, persistent JSON demo database, server-side password hashing, cookie sessions, customer/admin roles, recorded admin balance adjustments, audit events, and five UI languages.

## Requirements
- Node.js 20.9 or newer

## Run locally
1. Install dependencies with `npm install`.
2. Start the development server with `npm run dev`, or build and run with `npm run build` and `npm start`.
3. Visit the URL printed in the terminal. Set `PORT` if the default port is busy (for example, `$env:PORT=3001; npm run dev` in PowerShell).

The server creates `data/db.json` automatically on first run. Keep this file private; it contains demo account data and password hashes.

## Demo credentials
- Administrator: `admin@hormans.demo` / `Admin123!`
- Customer: `jordan@example.com` / `Customer123!`

For a non-demo environment, set `DEMO_ADMIN_PASSWORD` and `DEMO_CUSTOMER_PASSWORD` before the first start. The seed accounts are created only when no database file exists. Delete `data/db.json` to reset the local demo database.

## Languages
English, French, Spanish, Portuguese and German. Language selection is available on the sign-in and dashboard screens. Some less prominent system labels may remain in English.

## Implemented API routes
- `GET /api/health`
- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/transactions`
- `POST /api/withdrawals` — creates a pending withdrawal request, records it in transaction history and directs the customer to Horman@hormansfinancialinstitute.com. Pending requests do not deduct the account balance.
- `POST /api/transfers` — disabled in this demonstration; no money is moved.
- `GET /api/admin/customers`
- `POST /api/admin/balance-adjustments` — admin-only, requires a reason, writes a ledger entry and audit event.
- `POST /api/admin/customer-status`
- `GET /api/admin/audit`

## Important safety and production limitations
This is a development demonstration, not a real bank and not suitable for real customer information or funds. It does not connect to a bank, payment processor, card network, KYC/AML provider or regulated ledger. Transfers are disabled. Withdrawal requests can be submitted for demonstration purposes and remain pending; they do not move funds or deduct balances. Balance adjustments are demo ledger entries, not settlement of real funds.

Before production use, replace the JSON store with a properly managed database, add TLS and secure cookie settings, CSRF protection, rate limiting, MFA, password reset and account recovery, robust input validation, monitoring, backups, independent security review, double-entry ledger controls, reconciliation, compliance/KYC/AML workflows, and a licensed banking/payment partner. Obtain legal and regulatory review before presenting this as a banking service. Never use the demo balances to represent actual customer deposits.
