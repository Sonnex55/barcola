# Horman's Financial Institute — UI prototype

A responsive front-end banking prototype built with HTML, CSS and vanilla JavaScript.

## Run it
Open `index.html` in a browser. For a local development server, run `python -m http.server 8000` in this folder and visit `http://localhost:8000`.

## Demo access
- Admin: `admin@hormans.demo` / `Admin123!`
- Sample customer: `jordan@example.com` / `Customer123!`
- You can also register a new customer profile.

## Included screens
- Sign in and registration
- Customer overview and account details
- Transactions and CSV export
- Simulated transfer flow
- Virtual debit card preview
- Admin customer management
- Admin balance adjustment with reason and recorded adjustment entry
- Account status controls
- English/French language selector UI
- Responsive layouts for mobile and desktop

## Important prototype limitations
This is a front-end demonstration. Data is stored in browser `localStorage`; it is not a secure database. Authentication is not production-grade, passwords are stored locally for demonstration, and payment/transfer actions do not move real money. The English/French selector currently demonstrates language selection but does not translate every screen. Before real-world banking use, replace the demo storage/authentication with a secure backend, password hashing, MFA, role-based authorization, an immutable double-entry ledger, audited balance adjustments, KYC/AML workflows, encrypted transport/storage, monitoring, and a licensed payment/banking provider. Do not enter real customer or financial information.
