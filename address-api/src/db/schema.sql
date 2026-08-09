-- Address Book schema
-- Applied idempotently on API start (see src/db/index.js initSchema()).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('read', 'readwrite', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id          SERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL UNIQUE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  address     TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       CHAR(2) NOT NULL,
  phone       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_addresses_last_name  ON addresses (lower(last_name));
CREATE INDEX IF NOT EXISTS idx_addresses_city       ON addresses (lower(city));
CREATE INDEX IF NOT EXISTS idx_addresses_state      ON addresses (state);
CREATE INDEX IF NOT EXISTS idx_addresses_customer   ON addresses (customer_id);

-- Free-text search across the human-meaningful columns.
CREATE INDEX IF NOT EXISTS idx_addresses_search ON addresses
  USING gin (to_tsvector('simple',
    first_name || ' ' || last_name || ' ' || address || ' ' ||
    city || ' ' || state || ' ' || phone || ' ' || customer_id));
