# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## SAC Flow engineering contract

During active development, all work is local-only. Do not push to GitHub, publish a Sites version, deploy externally, or write to Metricool unless the user gives explicit authorization for that exact action. Metricool writes include account records, connected accounts, configuration, messages, replies, tokens, automation state, and any other operation that changes the remote account.

The product direction is now a general automation platform inspired by the functional breadth of n8n, with the SAC/Metricool experience preserved as the primary first-party workspace and the most prominent operational module. Study n8n architecture and behavior as reference, but keep this implementation original and respect n8n licensing boundaries; do not copy Enterprise Edition source.

SAC Flow is a local-first SAC MVP for approximately 20 Instagram/Facebook brands accessed through Metricool. Keep the web client in `src/` and the Fastify boundary in `server/`. Browser code must call the internal `/api` contract; it must never call Metricool directly or receive Metricool credentials.

Runtime and deployment must be self-contained. Codex skills, plugins and research helpers—including Agent Reach/Exa—may inform development, but must never become application dependencies, runtime services, build requirements, Docker components or production integrations.

The default developer experience is one command (`npm run dev:all`): Vite on 5173 proxies `/api` to Fastify on 8787. The production/container experience is one Fastify process on 8787 with `SERVE_FRONTEND=true`, serving `dist/client` and preserving API 404s instead of returning the SPA shell for `/api/*`.

Keep Metricool behind an adapter and local JSON behind a repository interface so Techlab can replace JSON with PostgreSQL and move polling to workers without changing the frontend contract. JSON writes must remain serialized and atomic. Use stable external IDs for deduplication and idempotency; never treat Excel as persistence.

Demo mode must work with fictitious seeded data and without credentials. Live mode must be explicit. Never add tokens, real `userId`/`blogId` values, DMs, comments, email addresses, phone numbers or customer identifiers to tracked files, fixtures, screenshots, logs or XLSX samples.

Preserve provider limits in code and UI: Metricool API requires Advanced/Custom; Instagram exposes the main inbox only; comments on ads cannot be answered; Metricool informa plazos de 24 horas para comentarios y 7 días para DMs. La UI debe permitir siempre redactar, guardar e intentar una respuesta manual, advertir cuando esté fuera de plazo y dejar que Metricool/Meta decidan la aceptación final; no agregues comportamiento destinado a eludir esos límites.

Automatic sending is off by default. Automatic sending must reject ineligible/out-of-window items, every attempt must be auditable, and retries must avoid duplicate replies. An agent may manually attempt an old reply with explicit confirmation; sensitive or negative cases must remain eligible for human review.

The approved visual direction is a light blue workflow studio inspired by the supplied WIWO Lab reference: compact white header, slim icon-led navigation, cool white/blue surfaces, pale blue dotted canvas, rounded white nodes and electric-blue connectors/actions. Do not reintroduce orange or warm peach accents; reserve green/red only for meaningful success/risk states.

The default Home is a SAC operations center, not a generic automation landing page. Keep `Centro de operaciones SAC` and the operational hierarchy: actionable conversation queue, human review, unassigned work, account health and SAC flow state first; general automation inventory second. Never show a success percentage when there are zero executions, and never hardcode an environment such as production without verified runtime evidence.

The SAC inbox detail is the operator's primary workspace. Keep the complete inbound message, an optional chronological conversation history, a clearly labeled AI recommendation grounded in approved brand QA, and one editable response composer together in the same side panel. Clearing a draft must never delete the customer's remote message. Each brand must also have an organized document center with a records workbook, a separate approved-QA workbook, and categorized shared file links.

Keep two complementary SAC inbox experiences. `Bandeja SAC` remains the contact-centric triage, protocol, bulk-draft and export surface and must not be simplified as part of manual-workspace changes. `Gestión manual` is an account-first workspace inspired by the supplied Meta Business Suite reference: channel/type tabs above two simultaneous zones for queue and active conversation/composer. Keep required post context inline with the active conversation instead of adding a separate right rail. Adapt that operational anatomy to the WIWO.Nodes blue design system; never replace the existing inbox or enable automatic sending from the manual workspace.

Within `Gestión manual`, comment surfaces are post-centric. List one card per publication, order posts newest-to-oldest by the provider-supplied publication timestamp, and label the fallback honestly when only recent comment activity is available. Opening a post must load its exact unanswered inbound comments without mixing posts, order that work queue oldest-to-newest for SLA, and bind every manual action to the selected comment ID and version.

The SAC inbox list is contact-centric: show one row per verified person within the same account and social platform, with message and pending counts, while every operation remains bound to the exact inbound interaction being answered. Keep this visual person identity separate from the strict provider thread key used by reconciliation and automation. For comments, the response panel must show the provider-supplied post context and original-post link when available; never fabricate a permalink from a social ID.

Keep inbox freshness separate from response automation. A dedicated read-only worker may ingest Metricool on its configured interval while the visible inbox rereads local persistence in the background; neither action authorizes an outbound message. Show the last local view refresh separately from the last confirmed Metricool synchronization, and keep a manual `Actualizar ahora` action for an operator-triggered read sync.

When changing routes, response fields, environment variables, persistence shape, ports or operational behavior, update `.env.example`, `README.md`, `docs/API_CONTRACT.md`, and the relevant runbook in the same change. Before handoff run `npm run check`, `npm run build:all`, then `npm test`, followed by the Docker health smoke test; report commands and outputs, not assumptions.
