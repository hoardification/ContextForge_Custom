# address-api

Express REST API backing the address book. Postgres storage, JWT auth, three roles.

## Run

```bash
npm install
cp ../.env.example ../.env      # then edit
POSTGRES_HOST=localhost npm start
```

The API ensures the schema, creates bootstrap users, and auto-seeds 100 addresses
on first boot (set `AUTO_SEED=false` to disable).

## Bootstrap accounts

| Username | Default password | Role        | Set with           |
|----------|------------------|-------------|--------------------|
| admin    | admin123         | `admin`     | `ADMIN_PASSWORD`   |
| editor   | editor123        | `readwrite` | `EDITOR_PASSWORD`  |
| viewer   | viewer123        | `read`      | `VIEWER_PASSWORD`  |

The admin username is `ADMIN_USERNAME`; `editor` and `viewer` are fixed names.

These are read **only while the `users` table is empty**. On a database that has
already been bootstrapped, changing them has no effect — update the account
through the UI or `PUT /api/users/:id`, or recreate the database.

Change `MCP_PASSWORD` whenever you change `VIEWER_PASSWORD`. The MCP server
signs in as `viewer` for callers that present no JWT, so the two drifting apart
turns every unauthenticated tool call into a 401. `docker-stack/check-env.ps1`
warns when they differ.

## Forced password change

An account holding a password published in this repository is treated as
already expired. Login still succeeds — you need to be able to get in to fix
it — but the token it returns carries `scope: 'password_change'`, and
`requireAuth` refuses that token on every route except
`POST /api/auth/change-password`. The role claim is left alone, so a locked
`admin` is still nominally an admin; the scope is what stops it.

```
POST /api/auth/change-password     Authorization: Bearer <scoped or full token>
{ "currentPassword": "...", "newPassword": "..." }
  -> { token, mustChangePassword: false, user }
```

The replacement must be at least 12 characters, must differ from the current
one, and must not itself be a published password. The response carries a full
token, so nothing has to log in twice.

The check runs on **every login**, not only at seed time, so it also catches a
database seeded before this existed and an account an admin later sets back to
a published value. `must_change_password` on `users` persists the state; the
list of published passwords lives in [`src/publicPasswords.js`](src/publicPasswords.js).

A service account cannot answer a password prompt. If `MCP_USERNAME` is locked,
the MCP server fails with `PASSWORD_CHANGE_REQUIRED` and says to fix `.env`
rather than retrying forever.

## Endpoints

| Method | Path                                   | Min role    |
|--------|----------------------------------------|-------------|
| POST   | `/api/auth/login`                      | public      |
| POST   | `/api/auth/change-password`            | any (own account) |
| GET    | `/api/auth/me`                         | read        |
| GET    | `/api/addresses?q=&page=&pageSize=`    | read        |
| GET    | `/api/addresses/stats`                 | read        |
| GET    | `/api/addresses/:id`                   | read        |
| GET    | `/api/addresses/by-customer/:customerId` | read      |
| POST   | `/api/addresses`                       | readwrite   |
| PUT    | `/api/addresses/:id`                   | readwrite   |
| DELETE | `/api/addresses/:id`                   | admin       |
| GET    | `/api/users`                           | admin       |
| POST   | `/api/users`                           | admin       |
| PUT    | `/api/users/:id`                       | admin       |
| DELETE | `/api/users/:id`                       | admin       |
| POST   | `/api/admin/reseed`                    | admin       |
| GET    | `/api/admin/stats`                     | admin       |

## Quick check

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

curl -s "localhost:4000/api/addresses?q=Austin&pageSize=5" \
  -H "authorization: Bearer $TOKEN" | jq
```
