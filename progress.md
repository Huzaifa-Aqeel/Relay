# Relay Build Progress

Last updated: 2026-09-21 (Asia/Karachi)

## Source of truth

- Product requirements: `relay_functional_requirements.md`
- Product loop: Capture → Structure → Preflight → Resolve → Publish → Ask
- Android first, iOS second, using Expo, Supabase, RevenueCat, Unstructured, and Astra DB.

## Implemented

- Relay application identity, calm light visual system, icons, splash assets, onboarding copy, and package/deep-link configuration.
- Supabase authentication, session persistence, password recovery, protected owner routes, account deletion guardrails, and private push-token ownership.
- Real Organization, Role, and draft Handoff persistence with membership-aware RLS and private organization logos (`ACT-01`, `DOM-01`–`DOM-03`, `HAND-01`).
- Organization, role, and handoff creation/read screens with deliberate loading, empty, validation, and error states (`UI-01`).
- Source and Knowledge Item persistence with separate source evidence, seven allow-listed knowledge types, AI/manual origin, proposal status, provenance links, stable ordering, and RLS (`CAP-04`, `KNOW-01`–`KNOW-05`, `AI-02`).
- Typed/pasted source capture (`CAP-02`), manual approved knowledge entry (`CAP-05`, `AI-05`), and knowledge editing, deletion, and reordering (`HAND-03`).
- Foreground voice recording and document selection/upload use Expo SDK 57-compatible official modules. Original files are stored in a private, organization-scoped Supabase bucket with a 25 MB cap (`CAP-01`, `CAP-03`).
- Voice/document sources expose Processing, Ready, and Failed states, retain plain-language failures, allow retry, and keep editable manual transcript/source-text fallback available (`CAP-05`, `CAP-06`).
- Groq voice transcription is implemented server-side with `whisper-large-v3-turbo`; transcripts remain private, editable source evidence and never bypass review (`CAP-01`, `CAP-04`, `SEC-03`).
- Document ingestion is connected end to end: supported binary/visual files are parsed server-side by Unstructured, plain text/Markdown/CSV are decoded directly, typed content and page metadata are segmented within bounded limits, and the resulting records are indexed through Astra DB Vectorize (`CAP-03`, `CAP-04`, `CAP-06`, `RAG-01`–`RAG-04`).
- Document processing is asynchronous and resumable, retains the original private upload, validates the Astra collection contract, stages each indexing run safely, removes partial/stale chunks, and preserves organization/handoff/source metadata for later permission-filtered retrieval.
- Groq `openai/gpt-oss-120b` structured reasoning is implemented with strict JSON Schema. Output is independently validated, restricted to the seven knowledge types, required to carry an exact source excerpt, written atomically with provenance, and always enters the human queue as Proposed (`AI-01`–`AI-04`, `KNOW-01`–`KNOW-05`).
- Source processing and structuring screens use scoped Supabase Realtime Postgres Changes subscriptions. Fixed-interval database/PostgREST polling has been removed; reconnecting performs one cache refresh.
- Server-enforced transition into Review, a visually distinct proposal queue, and explicit Accept / Edit / Reject decisions without changing original sources (`HAND-04`, `KNOW-01`–`KNOW-05`, `UI-02`).
- Evidence-backed Handoff Preflight is implemented end to end: Groq checks approved knowledge plus permission-filtered Astra/source evidence for missing, ambiguous, incomplete, and contradictory information; strict validation and atomic persistence prevent unsupported or partial findings (`PRE-01`–`PRE-07`, `UI-03`).
- Preflight has polished Processing, Ready, Failed, and Stale states; each finding shows plain-language reasoning and evidence context, and admins can Resolve with new approved knowledge, edit the affected instruction, Skip, or mark it Unknown (`PRE-06`–`PRE-09`).
- Material source/knowledge changes invalidate prior readiness, processing runs fail closed if knowledge changes concurrently, and scoped Supabase Realtime updates the mounted Preflight without database polling.
- Readiness shows concrete approved/resolved/unresolved counts without an AI percentage. Optional findings allow Preview; unresolved critical findings require an explicit, attributable acknowledgement (`READY-01`–`READY-03`). The next publish phase must enforce the same gate before exposure.
- Exact Preview and the public recipient page use the same calm, mobile-first renderer, with Start Here, grouped/filterable knowledge, prominent warnings, and actionable email/phone/web contacts (`PUB-01`, `REC-01`–`REC-05`).
- Publishing rechecks current Preflight readiness server-side and atomically snapshots approved knowledge only. Original sources, proposals, provenance, private IDs, and Preflight details never enter the public payload (`HAND-04`, `PUB-02`, `PUB-04`, `PUB-06`, `SEC-01`, `SEC-02`).
- Active Handoffs support copy, native share, QR display, immediate revocation, and token replacement. Revocation never deletes the Handoff or immutable snapshot, and old/replaced tokens fail closed (`PUB-03`, `PUB-05`). Published drafts are frozen against accidental client-side edits.
- Credentials warning and private-by-default copy (`SEC-01`, `SEC-05`, `SEC-06`).
- Invalid, unknown, revoked, and replaced public tokens all return the same non-disclosing unavailable state.
- Ask Relay is implemented on the no-login recipient page with calm question/answer UI, explicit trust copy, daily remaining-use feedback, and accessible citation cards (`ASK-01`–`ASK-07`).
- Ask resolves the active publication before retrieval, filters Astra by organization/Handoff, uses vector matches only to rank immutable published Knowledge Items, and never sends raw/private source chunks to Groq. Strict-schema responses require valid published evidence refs; unsupported answers are normalized to a fixed plain-language refusal.
- Publication now snapshots safe source labels/locators for citations. Recipient answers cannot read or modify the private canonical Handoff, and questions/answers/raw sources are not logged.
- RevenueCat retains the authenticated Supabase user UUID as purchaser identity, while Supabase now associates that verified entitlement with one selected Organization. `organization_subscriptions` keeps purchaser and Organization separate, stores refreshable active/inactive state rather than a permanent `is_pro` flag, and supports an Organization remaining understandable through a later owner change (`MON-01`, `MON-06`, `MON-08`).
- Purchase and Restore pass explicit Organization context, authorize it server-side, reconcile without duplicate associations, refresh Organization plan state immediately, and refuse to silently move an active entitlement to an unrelated Organization. The webhook refreshes existing state but never guesses the target Organization (`MON-03`, `MON-05`).
- Free limits are enforced by database RPCs—not UI assumptions—at one owned organization per Free owner account, then one active Role and one current Handoff per Free Organization. Premium attempts open a contextual “Upgrade [Organization]” paywall; direct Role/Handoff inserts cannot bypass limits (`MON-02`, `MON-03`, `MON-06`). Downgrades never delete existing data or remove recipient access (`MON-07`).
- Ask allowances are claimed atomically without database polling: 10 requests per published Handoff/day by default for Free and 100 for an associated Pro Organization, both server-configurable and bounded against public-link abuse.

## Verified foundation

- `npm run typecheck` — passed on 2026-09-21.
- `npm test` — 2 application tests passed on 2026-09-21.
- `npm run test:db` — 184 database tests passed on 2026-09-21, including Organization-scoped Pro access, unrelated Organizations remaining Free, purchaser/member separation, idempotent association, downgrade retention, recipient access, Preflight/publication protections, atomic Ask claims, and RLS.
- `npx supabase db lint --local --level warning` — no schema errors on 2026-09-21. The organization-scoped migration `202609210012` was applied locally.
- Live headless Groq smoke test — private audio → `whisper-large-v3-turbo` transcript `ready`; typed evidence → `openai/gpt-oss-120b` → 3 strict-schema proposals, all still Proposed with exact source evidence, on 2026-09-21. Temporary account, organization, storage object, and files were removed.
- Live headless ingestion smoke test — PDF upload → Unstructured extraction → Astra Vectorize indexing → source `ready`; 4 indexed chunks with matching source metadata on 2026-09-21. Temporary verification data was removed.
- Live headless Preflight smoke test — approved vague knowledge + source provenance → permission-filtered Astra retrieval → Groq `openai/gpt-oss-120b` → one Critical/Missing finding with two stored evidence snapshots → run `ready`, on 2026-09-21. Temporary account and organization data were removed.
- Headless recipient UI verification — a temporary seven-section published Handoff rendered successfully at a 412×915 mobile viewport and full-page viewport, including warning emphasis and actionable contact controls, on 2026-09-21. Temporary account, publication, and screenshots were removed.
- Live headless Ask Relay smoke test — supported RoboFest question returned the published 12-week instruction with its immutable source citation; unsupported laptop-funding question returned the exact reliable-answer refusal with no citations. Temporary account/publication data was removed on 2026-09-21.
- `npm run build:web` and Android Expo export — production bundles passed with Organization-scoped RevenueCat integration on 2026-09-21.
- Expo Doctor — 21/21 checks passed on 2026-09-21; required native peers are installed, including the audio module's direct `expo-asset` peer.
- `npm audit --omit=dev` reports 14 Moderate transitive findings in Expo Router's URL parser chain and Expo config tooling. npm offers only forced breaking Expo package changes, so no unsafe automatic downgrade was applied; recheck with future Expo SDK patches.
- UI/browser checks must remain headless unless the user explicitly requests otherwise.
- Verification is batched at dependency boundaries or handoff milestones, not after every small change.

## P0 implementation status

All P0 product code in `relay_functional_requirements.md` is implemented. Remaining work is deployment/store activation and real-device release validation, not another P0 feature module.

## External configuration still needed

- Hosted Supabase URL and publishable client key when connecting this build to the user's hosted project.
- Unstructured and Astra credentials are configured for local development. Before hosted deployment, add the same server-only secrets to the hosted Supabase project.
- Astra target is ready: keyspace `default_keyspace`; collection `relay_handoff_chunks`; Astra-hosted NVIDIA `nvidia/nv-embedqa-e5-v5`; 1024 dimensions; cosine similarity. Unstructured parses without embedding, and Astra Vectorize owns both document and Ask Relay query embeddings.
- Groq is configured and live-verified locally for transcription and reasoning. Add the same server-only Groq configuration to hosted Supabase before deployment.
- Set `EXPO_PUBLIC_RELAY_WEB_ORIGIN` to the deployed Expo web origin so native share and QR actions point to the browser recipient page.
- RevenueCat's Test Store SDK key, server secret API key, and `relay_pro` entitlement ID are configured locally. The private `REVENUECAT_WEBHOOK_AUTHORIZATION` value is still empty; configure it before webhook validation and add all server-only values to hosted Supabase secrets.
- In RevenueCat Test Store, attach one annual product to the current offering's Annual package, configure the `relay_pro` entitlement, point the authenticated webhook at `revenuecat-webhook`, and use its exact private Authorization value. Relay Pro is annual-only.
- Apply hosted migrations through `202609210012`, deploy `ask-relay`, `sync-revenuecat-entitlement`, and `revenuecat-webhook`, then validate purchase, cancellation, restore, renewal, expiry/downgrade, and contextual Organization gates in an Android Expo development build. Repeat the store validation on iOS second.

Provider secrets must never use `EXPO_PUBLIC_*` variables or ship in the Expo client.
