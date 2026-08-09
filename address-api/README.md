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

## Endpoints

| Method | Path                                   | Min role    |
|--------|----------------------------------------|-------------|
| POST   | `/api/auth/login`                      | public      |
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
