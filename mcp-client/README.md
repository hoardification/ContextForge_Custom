# mcp-client

Demonstrates the MCP server driven by a **self-hosted** model — Ollama running
`qwen2.5:7b-instruct` (~4.7 GB quantized, comfortable inside 8 GB RAM and
strong at tool calling).

Two pieces:

- `server/` — Node backend. Opens an MCP session, hands the tool list to Ollama,
  runs the tool-calling loop, returns the answer plus a trace.
- `ui/` — React. **One search box.** No create/edit/delete forms anywhere —
  every mutation happens because the model chose to call a tool.

## Permission inheritance

The user logs in, the browser holds their JWT, the backend forwards that JWT to
the MCP server, and the MCP server forwards it to the REST API. So:

- signed in as `viewer` → the agent can search, and a delete attempt returns FORBIDDEN
- signed in as `editor` → it can also create and update
- signed in as `admin` → it can delete, reseed and manage users

The model never gets more authority than the human driving it.

## Run locally

```bash
ollama serve
ollama pull qwen2.5:7b-instruct

cd server && npm install
MCP_SERVER_URL=http://localhost:4100/mcp \
  API_BASE_URL=http://localhost:4000 \
  OLLAMA_URL=http://localhost:11434 npm start

cd ../ui && npm install && npm run dev
```

## Things to try

- "Find everyone in Austin, TX"
- "How many addresses are in the book, and which states have the most?"
- "Add Jane Doe, 42 Oak St, Boise ID, customer CUST-999001, phone (208) 555-0110"
- "Change CUST-999001's phone to (208) 555-0199"
- "Delete CUST-999001" — as `viewer` this is refused, as `admin` it works
- "Reseed the database with 250 records" — admin only

## Memory budget

| Container   | Approx RSS |
|-------------|-----------|
| Ollama + qwen2.5:7b Q4 | ~5.5 GB while generating |
| Postgres    | ~150 MB |
| Node services (×3) | ~80 MB each |
| nginx (×2)  | ~10 MB each |

Comfortable on an 8 GB machine as long as the model is the only large thing
resident. If it's tight, switch `OLLAMA_MODEL` to `qwen2.5:3b-instruct`.

## Progress reporting

A 7B model on CPU routinely spends 30-90 seconds per step, and a request can
take several steps. `POST /api/ask` returns nothing until all of that is done,
so a slow run and a hung one are indistinguishable from the browser -- which is
the single most common "is it broken?" moment in this stack.

`POST /api/ask/stream` does the same work and reports it as it happens, as
server-sent events:

| Event | When | Payload |
|-------|------|---------|
| `start` | request accepted | `model`, `maxSteps`, `heartbeatMs` |
| `status` | session lifecycle | `stage` (`connecting`, `ready`), `detail` |
| `thinking` / `thought` | a model turn begins / ends | `step`, `maxSteps`, `ms` |
| `tool_start` / `tool_end` | an MCP tool call begins / ends | `tool`, `args`, `ok`, `ms`, `preview` |
| `answer` | the model stopped calling tools | `answer`, `steps` |
| `done` | finished | full result, `trace`, `elapsedMs` |
| `error` | failed | `code`, `message` |
| `cancelled` | client hung up or pressed Stop | `elapsedMs` |
| `heartbeat` | every `AGENT_HEARTBEAT_MS` | `elapsedMs` |

The heartbeat is the part that answers "is it locked up". It keeps arriving
while the model is mid-generation, so silence means something is genuinely
wrong. The UI shows a pulse tied to it and calls out a stall after 25s.

`/api/ask` is unchanged and still returns a single JSON body -- useful for
scripts and tests, where progress is noise.

### Bounds

Each is an env var, in milliseconds:

| Variable | Default | Applies to |
|----------|---------|-----------|
| `AGENT_HEARTBEAT_MS` | 10000 | how often liveness is proven |
| `OLLAMA_TIMEOUT_MS` | 180000 | one model call |
| `MCP_TOOL_TIMEOUT_MS` | 60000 | one tool call |
| `AGENT_TIMEOUT_MS` | 600000 | the whole request |

They exist to tell slow apart from dead, so they are deliberately generous.
Raise `OLLAMA_TIMEOUT_MS` on a machine where the first call after an idle
period has to load the model back into memory.

Cancellation is wired to the response stream, not the request: since Node 16 a
request stream emits `close` once its body has been read, which for a POST is
immediately, so listening there would abort every run on arrival.
