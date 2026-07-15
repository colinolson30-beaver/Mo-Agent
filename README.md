# FleetPilot

Live-fleet-theater demo: a real Claude agent operating a simulated K-12 MacBook district (512 devices, 3 schools) through a Mosyle-shaped tool layer. Chat on the left, live fleet board on the right. The agent is real; the fleet is fake.

Design doc: `~/.gstack/projects/PortCoAIProject/*-design-*.md`

## Run

```bash
npm install
copy .env.example .env.local        # then paste your key from console.anthropic.com/settings/keys
npm run demo                        # = next build && next start (use this for demos, not dev mode)
```

Open http://localhost:3000.

Without an API key the fleet board and the **◉ wave** debug button (top right) still work — only the chat needs the key.

## Timed deployments

"Push Kahoot to the 6th grade devices for 24 hours" → the agent passes `remove_after_hours: 24` on `install_app`. One approval covers the whole lifecycle: install wave runs, the completion card reads "Successfully deployed — automatic removal scheduled in 24h", then the removal sweep runs by itself when the clock expires. Fleet-hours run on a compressed demo clock (`FLEETPILOT_MS_PER_HOUR`, default 5000ms → 24h ≈ 2 minutes) so the cleanup happens while the audience is still watching.

Test it without the LLM:

```bash
curl -X POST http://localhost:3000/api/debug/wave -H "content-type: application/json" -d "{\"app\":\"Kahoot\",\"remove_after_hours\":24}"
```

## The four demo beats

1. **Query** — "Which devices haven't checked in since spring break?" → 23 stragglers highlighted (19 in LN-C3, 4 staff loaners).
2. **Action** — "Push Chrome to the 6th grade carts" → plan card, blast radius (32 devices, 2 groups), Approve → 5 canary devices → verify → fan-out wave.
3. **Guardrail** — "Wipe every device in the district" → the agent CAN call erase_device; the tool executor refuses at fleet scope, lights up all 512 tiles red, and explains what elevation would require. This beat is the thesis.
4. **Remediation** — after the wave: "How did the push go?" → 3 seeded failures in Room 114 (devices ack, fail, then drop offline). The agent proposes a retry as a normal plan card; the retry queues because the devices are offline.

## Architecture

- `lib/sim/` — in-memory district simulator. Deterministic seed, command lifecycle state machine (queued → pushed → acknowledged → done/failed), canary-then-fanout rollout policy, singleton on `globalThis`.
- `lib/agent/` — 9 tool definitions + executor. The guardrail policy table is enforced in the executor, not the prompt: a refuse-cell call registers no plan and returns `{refused, blast_radius, elevation_text}`. A misbehaving model is a narration bug, never a safety bug.
- `app/api/chat` — streaming Claude tool loop (`claude-sonnet-5`; override with `FLEETPILOT_MODEL`). Mutating tools register plans; execution happens only via `app/api/approve` (no LLM in the execution path). Reads `ANTHROPIC_API_KEY` from `.env.local`.
- `app/api/events` — SSE: snapshot + deltas → zustand → CSS-transition tile grid.

## Demo-day notes

- Rehearse with the **◉ wave** button first; it exercises the full choreography with zero AI.
- `npm run demo` (production build), not `npm run dev`.
- Fallback if the LLM API is down: the wave button covers the visual; a screen recording covers the chat beats.
