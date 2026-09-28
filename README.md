# eve-care

Backend for booking diagnostic tests at diagnostic centres, with a simulated payment provider and an idempotent payment webhook.

**Stack:** Bun + TypeScript, Express 5, PostgreSQL, Prisma 7, Zod, JWT, pino, Docker.

```
eve-care/
├── backend/            # the API
│   ├── src/
│   │   ├── routes/       # one router per area (auth, centres, bookings, payments…)
│   │   ├── middleware/   # user and hospital JWT checks
│   │   ├── types/        # zod schemas for every request body / param / query
│   │   ├── utils/        # mock payment provider, retry, rate limits, logger, tokens
│   │   └── docs/         # OpenAPI spec
│   ├── scripts/sendWebhook.ts   # send a signed webhook by hand
│   └── tests/
├── db/                 # prisma schema, migrations, seed, shared client (@repo/db)
├── Dockerfile
└── docker-compose.yml  # postgres + api
```

---

## Running it

### With Docker (easiest)

```bash
cp backend/.env.example backend/.env   # then replace the secrets, e.g. with `openssl rand -hex 32`
docker compose up --build
```

This starts Postgres and the API on **http://localhost:8080**. Migrations run automatically when the container starts. Compose reads the secrets from `backend/.env` and has no fallback values, so the API refuses to start if one is missing (see [Environment variables](#environment-variables-backendenv)).

Load some sample data (optional):

```bash
docker compose exec api sh -c "cd /app/db && bun prisma/seed.ts"
```

### Locally

Needs [Bun](https://bun.sh) 1.3+ and Postgres (or Docker just for the database).

```bash
bun install                      # installs both workspaces

cd db
cp .env.example .env
bun run db:up                    # postgres in docker on :5432 (skip if you have your own)
bunx prisma migrate deploy
bun run db:seed                  # optional sample data

cd ../backend
cp .env.example .env
bun run dev                      # http://localhost:8080
```

> `db/docker-compose.yml` and the root `docker-compose.yml` both use port 5432, so only run one of them.

### API docs

Swagger UI: **http://localhost:8080/docs** (raw spec at `/docs/openapi.json`). Sign in, click **Authorize** and paste the `accessToken`.

### Seed accounts

| Role     | Email                         | Password       |
|----------|-------------------------------|----------------|
| user     | `seed.asha@example.com`       | `User@1234`    |
| user     | `seed.nobookings@example.com` | `User@1234`    |
| hospital | `seed.citycare@example.com`   | `Hospital@123` |

The seed creates 4 centres, 14 tests, 4 users and 7 bookings: at least one booking in every state (Pending, Confirmed, Failed, Cancelled and refunded).

### Tests

```bash
cd backend
bun test
```

The tests are integration tests. They start the app on a random port and hit it over HTTP against the database in `backend/.env`. Every run makes its own users, hospital and tests (emails tagged with a timestamp) and deletes them afterwards, so the tests can run against a database that already has data. They cover auth, validation, centres and pagination, booking, cancel, payments, webhook idempotency and ordering, transaction rollback and rate limits.

### Environment variables (`backend/.env`)

| Variable                        | What it's for |
|---------------------------------|---------------|
| `DATABASE_URL`                  | Postgres connection string |
| `ACCESS_TOKEN_SECRET`           | signs user access tokens |
| `HOSPITAL_TOKEN_SECRET`         | signs hospital access tokens |
| `REFRESH_TOKEN_SECRET`          | signs user refresh tokens |
| `HOSPITAL_REFRESH_TOKEN_SECRET` | signs hospital refresh tokens |
| `USER_REFRESH_COOKIE`           | cookie name for the user refresh token, e.g. `refreshToken` |
| `REFRESH_COOKIE`                | cookie name for the hospital refresh token, e.g. `hospitalRefreshToken` |
| `WEBHOOK_SECRET`                | shared with the payment provider to sign webhooks |
| `PORT`                   | default `8080` |
| `LOG_LEVEL`              | pino level, default `debug` in dev and `info` in production |
| `MOCK_PROVIDER_ENABLED`  | `false` stops the mock provider from calling the webhook (tests send webhooks themselves) |
| `WEBHOOK_URL`            | where the mock provider sends webhooks, default `http://localhost:$PORT/payments/webhook` |

Everything above `PORT` is required. `src/utils/env.ts` checks it at startup and the server exits with a clear log line if a variable is missing, or if the user and hospital secrets or cookie names are the same. Otherwise a missing secret would only show up later as a 500 on the first signin, and matching secrets or cookie names would let one kind of token pass as the other.

---

## API

Everything is under `/api` except `/payments`, which sits at the root because that's the path the brief asks for. Requests and responses are JSON. Routes marked 🔒 need `Authorization: Bearer <accessToken>`. **User and hospital tokens are signed with different secrets, so neither works on the other's routes.**

| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/api/user/auth/signup` | | create a user |
| POST | `/api/user/auth/signin` | | returns `accessToken` (15 min), sets `refreshToken` cookie (30 days) |
| POST | `/api/user/auth/refresh` | cookie | new access token, rotates the refresh token |
| POST | `/api/user/auth/logout` | cookie | revokes the refresh token |
| POST | `/api/hospital/auth/signup` · `signin` · `refresh` · `logout` | | same, for centres |
| GET | `/api/centres?page=&limit=&search=&location=` | | list centres, paginated |
| GET | `/api/centres/:id` | | one centre with all its tests and prices |
| GET | `/api/hospital/tests/my-tests` | 🔒 hospital | the hospital's own tests |
| POST | `/api/hospital/tests/add-test` | 🔒 hospital | add a test |
| PUT | `/api/hospital/tests/update-test/:id` | 🔒 hospital | change name/price |
| DELETE | `/api/hospital/tests/remove-test/:id` | 🔒 hospital | delete a test with no bookings |
| POST | `/api/user/booking/search-by-hospital` | 🔒 user | tests at a centre, by name |
| POST | `/api/user/booking/search-by-tests` | 🔒 user | every centre offering a test, with its price |
| POST | `/api/user/booking/booking` | 🔒 user | book a test |
| GET | `/api/user/booking/bookings` | 🔒 user | my bookings |
| GET | `/api/user/booking/booking/:id` | 🔒 user | one booking with test, centre and payment |
| POST | `/api/user/booking/booking/:id/cancel` | 🔒 user | cancel (refunds if paid) |
| POST | `/payments` | 🔒 user | start a simulated payment |
| GET | `/payments/:id` | 🔒 user | payment + booking status |
| POST | `/payments/webhook` | signature | payment result from the provider |

### Walkthrough

```bash
API=http://localhost:8080

# 1. sign up and sign in
curl -X POST $API/api/user/auth/signup -H "Content-Type: application/json" \
  -d '{"username":"asha","email":"asha@example.com","password":"User@1234"}'
# 201 {"message":"<userId>"}

TOKEN=$(curl -s -X POST $API/api/user/auth/signin -H "Content-Type: application/json" \
  -d '{"email":"asha@example.com","password":"User@1234"}' | jq -r .accessToken)

# 2. find a centre and a test
curl "$API/api/centres?location=kolkata&page=1&limit=10"
# {"centres":[{"id":"…","hopitalname":"City Care Hospital","location":"Kolkata","_count":{"Tests":5}}],
#  "page":1,"limit":10,"total":1,"totalPages":1}

curl $API/api/centres/<centreId>
# {"centre":{"id":"…","hopitalname":"City Care Hospital","location":"Kolkata",
#   "Tests":[{"id":"…","name":"Complete Blood Count","price":350}, …]}}

# 3. book it
curl -X POST $API/api/user/booking/booking -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"testid":"<testId>","date":"2026-12-01T10:30:00+05:30"}'
# 201 {"booking":{"id":"…","status":"Pending","price":350,"date":"2026-12-01T05:00:00.000Z", …}}

# 4. pay. Idempotency-Key is a fresh UUID per attempt; "simulate" is optional
curl -X POST $API/payments -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f1c2a4e-8b1d-4f3a-9c7e-2d5b8a1f0e93" \
  -d '{"bookingId":"<bookingId>","simulate":"success"}'
# 202 {"payment":{"id":"…","status":"Created","amount":350, …}}
# sending the exact same request again → 200 with the same payment, nothing new is created

# 5. ~1.5s later the mock provider has called the webhook
curl $API/payments/<paymentId> -H "Authorization: Bearer $TOKEN"
# {"payment":{"status":"Success", …, "booking":{"id":"…","status":"Confirmed"}}}
```

Sending a webhook by hand (e.g. to replay an event and watch it get ignored):

```bash
cd backend
bun run webhook <paymentId> SUCCESS              # new event
bun run webhook <paymentId> SUCCESS evt_abc123   # send the same eventId twice → second is "event already processed"
```

### Status codes

| Code | When |
|---|---|
| 400 | body/params/query fail validation, malformed JSON, appointment date in the past |
| 401 | no token, bad or expired token, wrong password, bad webhook signature |
| 404 | not found **or not yours**: someone else's booking or payment looks exactly like a missing one, so ids can't be probed |
| 409 | state conflict: already booked, booking not payable, payment already running, test has bookings |
| 422 | `Idempotency-Key` reused for a different booking |
| 429 | rate limited |

---

## Database design

```
User 1───* Booking *───1 Test *───1 Hospital
              │
              1
              │
              0..1
           Payment            Webhook (event log, no FK)
```

| Table | Key columns | Notes |
|---|---|---|
| `User` | `id` uuid, `email` unique, `password` (bcrypt), `refreshtoken` (sha256, nullable) | refresh token is stored hashed, so a DB leak doesn't leak sessions. `null` = not signed in |
| `Hospital` | `id`, `email` unique, `hopitalname` unique, `location`, `refrestoken` | a diagnostic centre; has its own login |
| `Test` | `id`, `name`, `price` int, `hospitalId` FK | a test *as offered by one centre*: the same test at two centres is two rows with their own prices |
| `Booking` | `id`, `userId` FK, `testId` FK, `price`, `date`, `status` enum | the centre comes from `test.hospitalId`, so it isn't stored again |
| `Payment` | `id`, `bookingId` **unique** FK, `amount`, `status` enum, `idempotencyKey` **unique**, `providerRef` **unique**, `failureReason` | |
| `Webhook` | `id`, `eventID` **unique**, `type`, `payload`, `status`, `recivedAt` | every provider event we processed |

Enums: `Status = Pending | Confirmed | Failed | Cancelled`, `PaymentStatus = Created | Success | Failed | Refunded`.

Why it looks like this:

- **`Booking.price` is copied from the test when booking.** A centre changing its price later must not change what an existing booking costs.
- **`Payment.bookingId` is unique**: one payment per booking at the database level, so two concurrent `POST /payments` can't both charge.
- **`Payment.idempotencyKey` is unique**: a retried request finds the first payment instead of making a second one.
- **`Payment.providerRef` is unique**: it's how the webhook finds the payment, like a gateway's transaction id.
- **`Webhook.eventID` is unique**: this is what makes the webhook idempotent (below).
- **No unique `(userId, testId)` on Booking.** I tried it (see migrations) and took it out: a user must be able to book the same test again after a booking failed or was cancelled. "Only one *active* booking per test" is checked in code instead.
- The booking → centre link goes through `Test`, so a booking can never point at a centre that doesn't offer its test.

### Booking and payment states

```
                    POST /payments
 Booking: Pending ─────────────────► (Payment: Created) ──webhook SUCCESS──► Booking Confirmed, Payment Success
     │                                        └──────────webhook FAILED───► Booking Failed,    Payment Failed
     │
     └── cancel ──► Cancelled   (if already paid → Payment Refunded)
                    (if the payment is still running and later succeeds → webhook refunds it)
```

A `Failed` or `Cancelled` booking is final. To try again the user makes a new booking.

---

## How the tricky parts work

### Webhook idempotency (`POST /payments/webhook`)

1. **Signature first.** The body is HMAC-SHA256 signed with `WEBHOOK_SECRET` and compared in constant time against the *raw* bytes. Anything unsigned gets a 401 and never touches the database.
2. **One transaction** does three things together: insert the event into `Webhook`, update the payment, update the booking. It commits all of it or none of it.
3. **Duplicate event → the insert fails on `eventID` unique**, the whole transaction rolls back, and the endpoint answers **200 "event already processed"** so the provider stops retrying. This holds even when two copies of the event arrive at the same moment, because Postgres enforces the unique index, not a "check then insert" in code.
4. **Conditional updates**: the payment only changes `WHERE status = 'Created'` and the booking only `WHERE status = 'Pending'`. So a *different* event for an already settled payment (e.g. FAILED arriving after SUCCESS) is recorded as `ignored` and changes nothing.
5. **Unknown `providerRef` → 404 and nothing recorded**, so when the provider retries later it isn't mistaken for a duplicate.
6. **Cancel vs. webhook race**: if the user cancels while the payment is running and then SUCCESS arrives, the booking stays Cancelled and the payment becomes `Refunded`. If the two transactions deadlock, Postgres aborts one and it is retried (`utils/retry.ts`).

### Payment request idempotency (`POST /payments`)

The client sends an `Idempotency-Key` UUID. The same key and the same booking returns the original payment (200). The same key with a different booking returns 422. A new key for a booking that already has a payment returns 409. Concurrent duplicates are caught by the unique indexes (`P2002`) and answered the same way.

### Mock provider (`utils/mockProvider.ts`)

It plays the part of the payment gateway. After a payment is saved it waits 1.5s, picks SUCCESS (80%) or FAILED (or whatever `simulate` asked for), signs the event and POSTs it to our own webhook. It **retries with exponential backoff** (1s, 2s, 4s, 8s) on network errors, 5xx, 404 and 429, and sends the *same* eventId every time, so a retry whose first attempt actually went through is harmless.

### Other edge cases handled

- invalid UUIDs in paths → 400, not a Prisma crash
- someone else's booking or payment → 404 (not 403, so ids can't be probed)
- a hospital editing or deleting another hospital's test → 404
- deleting a test that has bookings → 409
- booking in the past, or a second active booking for the same test → 400 / 409
- paying for a Confirmed, Failed or Cancelled booking → 409
- a valid token for a user that was since deleted → 401
- malformed JSON body → 400
- a concurrent signup with the same email → 409 (caught at the unique index)
- `/api/centres` never returns email, password or tokens

### Also included

- **Structured logging** with pino: every request gets an `x-request-id`, and auth headers and cookies are never logged.
- **Rate limiting**: 100 req/min on `/api`, 10 attempts per 15 min on signin/signup, 20/min on payments. The webhook is never limited.
- **Swagger/OpenAPI** at `/docs`.
- **Docker** + docker-compose.
- **Pagination** on `/api/centres`.

---

## Assumptions

- **A centre is a `Hospital`** with its own login. Centres manage their own tests; users only book.
- **Prices are whole rupees (`Int`)**, which is enough for test prices and avoids floating point.
- **One payment attempt per booking.** If it fails, the booking is Failed and the user books again. That keeps the booking ↔ payment relation 1:1 and the state machine simple.
- **Refunds are simulated** by setting the payment to `Refunded`. No money moves anywhere.
- **The mock provider runs inside the API process.** In real life it would be a separate service. It still goes through the real HTTP webhook with a signature, so the webhook code doesn't know the difference.
- Appointment dates just have to be in the future. No slots, opening hours or capacity.
- Browsing centres is public. Searching and booking need a user account.

## What I'd improve with more time

- **Reconciliation job** for payments stuck in `Created` when the provider gives up retrying: ask the provider for the status (a Bull/BullMQ job), then expire the booking.
- **Move webhook processing to a queue**: accept, store, 200, then process in a worker. Right now it's processed inline, which is fine at this size.
- **Slots and capacity** per centre, instead of any future datetime.
- **Roles in one `Account` table** instead of separate User/Hospital tables with duplicated auth code, and admin routes to approve centres.
- **Redis** for caching the centre list and to share rate limit counters across instances (they're in memory now, so they only work with one instance).
- **Consistent API shape**: switch `search-by-*` to `GET` with query params, pluralise routes (`/bookings/:id`), and use one error format everywhere (`{ error: { code, message } }`).
- **Fix the column typos** (`hopitalname`, `refrestoken`, `recivedAt`) with a rename migration, and make `Webhook.status` an enum.
- Generate the OpenAPI spec from the zod schemas instead of writing it by hand, so the two can't drift apart.
- Unit tests for the pure pieces (retry, signature check) that don't need a database, and a separate test database in CI.
