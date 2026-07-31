# Clinic Shift Scheduler

A production-quality web application for managing clinic staff shifts, built as a take-home technical assessment.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express, TypeScript |
| Database | PostgreSQL 16 (via `pg` driver, raw SQL) |
| Auth | JWT (jsonwebtoken) + bcrypt with per-user salts |
| Frontend | React + TypeScript, Vite, Tailwind CSS v4 |
| Concurrency | `SELECT ... FOR UPDATE` row-level locking |

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)

### 1. Start the database
```bash
docker compose up -d
```

### 2. Set up the backend
```bash
cd server
npm install
cp .env .env  # Edit if needed — defaults work with docker-compose
npm run seed  # Runs migrations + imports CSV files
npm run dev
```
The server starts on `http://localhost:3000`.

### 3. Set up the frontend
```bash
cd client
npm install
npm run dev
```
The frontend starts on `http://localhost:5173` and proxies API calls to the backend.

## Seed Credentials

| Role | Email | Password |
|------|-------|----------|
| Manager | `admin@clinic.test` | `Manager123!` |
| Staff (Doctor) | `marcus.whitfield@clinicmail.test` | `Staff123!` |
| Staff (Nurse) | `anya.haddad@clinicmail.test` | `Staff123!` |
| Staff (Receptionist) | `ben.marchand@clinicmail.test` | `Staff123!` |

All imported staff accounts use password `Staff123!`.

## Project Structure

```
├── server/                  # Express API
│   └── src/
│       ├── db/              # Migrations, pool, seed
│       ├── importer/        # CSV parsing (pure functions)
│       ├── middleware/       # Auth + role guards
│       ├── routes/          # API endpoints
│       ├── services/        # Business logic
│       └── utils/           # Error classes
├── client/                  # React SPA
│   └── src/
│       ├── api/             # API client
│       ├── context/         # Auth context
│       └── pages/           # UI pages
├── staff.csv                # Source data
├── shifts.csv               # Source data
├── DECISIONS.md             # Design decisions
└── docker-compose.yml       # PostgreSQL
```

## Key Design Decisions

See [DECISIONS.md](DECISIONS.md) for the full list. Highlights:

- **Concurrency:** `SELECT ... FOR UPDATE` prevents race conditions when two staff claim the last slot simultaneously
- **Shift edits with claims:** Rejected if they'd create overlaps — never silently drops claims
- **CSV import:** Dirty data is handled with a clear accept/reject/merge/auto-correct pipeline. Every decision is recorded in the Import Report
- **Date parsing:** Separator-based format detection (slashes = DD/MM/YYYY, dashes = MM-DD-YYYY)

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Login |
| GET | `/api/shifts` | Any | List shifts |
| POST | `/api/shifts` | Manager | Create shift |
| PUT | `/api/shifts/:id` | Manager | Edit shift |
| DELETE | `/api/shifts/:id` | Manager | Delete shift |
| POST | `/api/shifts/:id/claim` | Staff | Claim shift |
| DELETE | `/api/shifts/:id/claim` | Staff | Unclaim shift |
| POST | `/api/shifts/:id/assign` | Manager | Assign staff |
| DELETE | `/api/shifts/:id/assign/:userId` | Manager | Unassign staff |
| GET | `/api/shifts/staff/all` | Manager | List all staff |
| GET | `/api/dashboard/coverage` | Any | Weekly coverage |
| POST | `/api/import/staff` | Manager | Upload staff CSV |
| POST | `/api/import/shifts` | Manager | Upload shifts CSV |
| GET | `/api/import/reports` | Manager | List import reports |
| GET | `/api/import/reports/:id` | Manager | Report detail |
