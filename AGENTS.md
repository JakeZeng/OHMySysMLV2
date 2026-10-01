# AGENTS.md

Browser-based SysML v2 MBSE modeling software. Differentiation: lightweight collaboration, open interop (ptc/25-04-32 JSON Schema), AI-assisted modeling, metamodel-driven extension. Active baseline lives in `poc-v2/`; `poc/` is a deprecated v1 shell kept only for historical reference.

## Setup commands

- Prereqs: Node.js 22.x, npm 11.x, Go 1.27.1
- Install root TS deps: `cd poc-v2 && npm install`
- Install frontend deps: `cd poc-v2/frontend && npm install`
- Generate parser: `cd poc-v2 && npm run parser:build` (writes `poc-v2/parser/parser.generated.ts`; run before first test/build)
- One-shot launcher (Windows): `powershell -ExecutionPolicy Bypass -File start.ps1`
- One-shot launcher (Unix): `./start.sh`

## Run commands

- Dev frontend: `cd poc-v2/frontend && npm run dev` (Vite on http://localhost:3000)
- Dev backend: `cd poc-v2/backend && go run cmd/server/main.go` (Gin on :8080, SQLite at `poc-v2/backend/sysmlv2.db`, override via `DB_PATH`)
- Build frontend: `cd poc-v2/frontend && npm run build`
- Preview frontend: `cd poc-v2/frontend && npm run preview`

## Test & verify

- TS unit + e2e: `cd poc-v2 && npm test` (109 vitest tests: 25 parser + 27 validator + 12 e2e + 5 layoutEngine + 5 perf + 10 textEdit + 25 importExport)
- TS watch mode: `cd poc-v2 && npm run test:watch`
- Frontend tests: `cd poc-v2/frontend && npm test`
- Go tests: `cd poc-v2/backend && go test ./...`
- Typecheck: `cd poc-v2/frontend && npm run typecheck`
- Full verify: `cd poc-v2 && npm run verify` (parser build + tests)

## Project layout

- `poc-v2/` — active project (TypeScript core + Go backend + React frontend)
  - `poc-v2/ast/` — AST type definitions (`ParseError`, `Package`, `PartDef`, `Connection`, …)
  - `poc-v2/parser/` — Peggy grammar (`sysml.pegjs`), TypeScript wrapper, `build.ts` codegen, `parser.generated.ts` (do not hand-edit)
  - `poc-v2/validator/` — semantic validator (name uniqueness, references, port direction, 11 error codes)
  - `poc-v2/transform/` — `modelToFlow.ts` AST → React Flow nodes/edges; `textEdit.ts` graph→text sync; `layoutEngine.ts` ELK.js auto-layout; `exportJson.ts` / `importJson.ts` / `serializer.ts` JSON import/export
  - `poc-v2/schema/` — `sysml-v2-poc.schema.json` + 3 example JSON files
  - `poc-v2/backend/internal/ai/` — OpenAI-compatible AI client (streaming SSE)
  - `poc-v2/examples/` — `simple-car.sysml`, `vehicle-system.sysml`, `broken.sysml`
  - `poc-v2/tests/` — vitest suites (`parser.test.ts`, `validator.test.ts`, `e2e.test.ts`)
  - `poc-v2/frontend/` — React 18 + Vite + TS + Monaco + React Flow + Tailwind + Radix UI + Antd
  - `poc-v2/backend/` — Go 1.23 + Gin + `modernc.org/sqlite` (no CGO); layered `cmd/`, `internal/{model,repository,service,handler}/`, `migrations/`
- `*.md` at root — design source of truth: `prd_sysmlv2.md` v0.2, `arch_sysmlv2.md`, `db_design.md`, `api_design.md`, `ui_ux_design.md`, `metamodel_design.md`, `tech_review_report.md` (4.4/10 — do not start before reading), `poc-v2-results.md`, `team_config.md`, `timeline_v2.md`

## Code style

- TypeScript: strict mode on (`poc-v2/tsconfig.json`); ESM (`"type": "module"`); ES2022 + DOM lib; no ESLint/Prettier configured — match surrounding code
- Go: `gofmt` default; no external linter configured; keep packages under `internal/`
- Frontend: Tailwind utility-first + Radix primitives + Antd for complex widgets; Zustand for state, TanStack Query for server state
- Parser: Peggy PEG syntax in `sysml.pegjs`; after editing run `npm run parser:build` and commit the regenerated `parser.generated.ts`

## Architecture invariants

- Pipeline: `SysML text → parse → validate → modelToFlow → React Flow`; any change touching one stage must keep the chain end-to-end runnable
- Backend uses `modernc.org/sqlite` (pure Go, no CGO) — do not add a CGO-dependent driver
- Frontend dev server proxies API requests to backend; do not hardcode absolute URLs in `modelApi.ts`
- SQLite uses single connection (`SetMaxOpenConns(1)`); multi-writer concurrency is a known limit (plan PostgreSQL migration for M2+)

## Testing instructions

- All tests must pass before opening a PR: `cd poc-v2 && npm test` and `cd poc-v2/backend && go test ./...`
- New behavior = new test in the matching `*.test.ts` next to the code (mirror existing layout)
- Parser/grammar changes require regenerating `parser.generated.ts` and re-running the full 100-test suite (root + frontend)
- E2E pipeline: `poc-v2/tests/e2e.test.ts` covers parse → validate → transform → flow

## Security & secrets

- Never commit secrets; `.env` files are gitignored (see `poc-v2/backend/.env.example`)
- `DB_PATH` controls SQLite location; default is `poc-v2/backend/sysmlv2.db`
- Backend reads `sysmlv2.db` from the working directory; be careful when running from CI

## Project status

- **M1 complete** (`a55612f`): parser (54 tests), validator (11 error codes), React Flow canvas, Monaco editor, Go backend + SQLite
- **M2 complete** (`36f964e`): bidirectional sync, ELK.js layout, React Flow perf, AI syntax check (Go SSE + OpenAI/DeepSeek), JSON import/export, error panel jump
- **M3 complete** (`m3/fix-dockerfile`): AI model generation (NL → SysML v2 via OpenAI/DeepSeek/Anthropic + FallbackChain), metamodel browser (28 SysML v2 elements), 3 industry templates (automotive/aerospace/software), security hardening (CSRF + CORS whitelist + rate limit + body size limit). See `poc-v2/docs/m3-summary.md` + 11 screenshots in `poc-v2/docs/screenshots/m3/`
- **M4 complete** (`m4/team-space`, see `poc-v2/docs/m4-summary.md`): team space + model sharing (SHA-256 hashed share tokens), audit logs (RBAC-filtered + CSV export + archive), version history + diff, admin role, 50+ M4.5 supplements (dark mode, 13 keyboard shortcuts, i18n-ready, PNG export, autosave)
- **M5 complete** (`c1a2dd6` + review fixes `0cb3666`/`47c33d7`/`b646353`): behavior/requirement/parametric views, template marketplace, Profile export, traceability links
- **M6 core landed** (`6ddcd07`/`d10636c`/`389ddd6`/`821dab5`): webhook notifications, API key auth, domain template packs (medical/industrial/ADAS), Papyrus XML + Capella JSON import
- **M7/M8 partial** (`fcdd49e`/`dd45cbf`/`13420c2`): design doc auto-generation, plugin system architecture, SaaS subscription tiers (Free/Pro/Enterprise)
- **Beyond plan**: real-time presence + cursor sharing (`993214f`), code generation Python/C++ (`ff97fa2`), SVG export, notification center, model comments, global search, i18n (zh/en), onboarding tutorials
- **Current**: integration testing / hardening pass (`218f7e3` 联调测试 — handler cleanup across 7 feature handlers + CSRF/security middleware); M6-M8 completion (OpenAPI spec, perf k6 report, security audit) still pending
- **Next**: finish M6 verification items (OpenAPI 3.1 spec, k6 perf report, external security audit) then M7/M8 completion
- Tech review (`tech_review_report.md`) scored 4.4/10 — read it before scoping new work
- Go is the locked backend language; DB is SQLite for MVP, PostgreSQL 16 + JSONB planned for production
- AI syntax check requires `AI_API_KEY` + `AI_PROVIDER` env vars (supports `openai` / `deepseek`)
