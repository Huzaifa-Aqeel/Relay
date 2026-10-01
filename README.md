# Relay

**Living role memory that survives handoffs, so every successor starts with what their predecessors knew.**

[▶️ Watch the demo](https://youtube.com/shorts/jgp_f2aqoUI?feature=share) · [📱 Download the Android APK](https://github.com/Huzaifa-Aqeel/Relay/releases/tag/v1.0.0)

## The Problem

Organizations regularly change the people responsible for important roles, but the knowledge needed to perform those roles often leaves with them.

Picture a student society's treasurer graduating. The new treasurer doesn't know which approvals the budget needs, which vendor requires a purchase order, or why last year's process was changed. That knowledge lives in old chats, spreadsheets, shared drives, and one person's head.

When it isn't transferred properly, incoming Role Holders waste time reconstructing processes, lose the context behind past decisions, repeat mistakes, and risk missing important work.

This continuity problem exists anywhere responsibility changes hands: student organizations, companies, nonprofits, associations, volunteer groups, project teams, committees, and recurring operational roles. Relay starts with student organization leadership transitions and is designed for any role-based handoff.

## The Solution

Relay turns scattered operational knowledge into a living, role-specific memory that survives people changing.

Throughout their time in a role, the Role Holder captures what they learn. Relay organizes it into useful operational knowledge (contacts, deadlines, processes, warnings and lessons), and the Role Holder reviews and approves what becomes part of the trusted handoff. When the role changes hands, the successor receives the published handoff, can ask Relay questions about it, and starts a new living handoff of their own. Over time, Relay shows what changed from one period to the next and, when evidence supports it, why.

**Why it's different:** notes apps and wikis store information. Relay adds human-approved knowledge, immutable published handoffs, source provenance, and change tracking across service periods.

## How Relay Works

**Capture → Organize → Review → Publish → Ask → Organization Memory**

### 1. Capture

The Role Holder captures knowledge throughout their term instead of reconstructing everything in a final transition meeting.

A Capture can include:

- typed context
- voice explanations
- documents
- spreadsheets
- policies
- forms
- event plans
- other supporting material

### 2. Organize

Relay considers the material in the Capture together and proposes useful operational knowledge for the next Role Holder.

This can include:

- procedures and workflows
- deadlines and lead times
- contacts
- rules and approvals
- systems and resources
- warnings and lessons
- unfinished obligations

Each suggestion retains provenance back to the supporting material.

### 3. Review

AI does not decide what becomes organizational knowledge.

The Role Holder reviews every suggestion and can:

- add it to the handoff
- edit it
- reject it

Only human-approved knowledge becomes part of the handoff.

### 4. Publish

When the handoff is ready, Relay creates an immutable published snapshot for that Organization, Role, and service period. Relay models continuity around a **Role** rather than around one individual.

The outgoing Role Holder invites the person taking over the same Role. When the incoming Role Holder accepts:

- the outgoing service period ends
- the incoming person becomes the active Role Holder
- they receive a clean handoff workspace for their own term
- the previous published handoff remains unchanged and accessible in History

The Organization Owner can also manage Role assignments for administrative recovery, so a Role is never stranded if its current holder becomes unavailable.

### 5. Ask Relay

The incoming Role Holder can ask questions about the previous published handoff.

Relay answers from approved handoff knowledge and its provenance, so the successor can find answers without manually searching every document or depending on the previous Role Holder to stay available.

### 6. Organization Memory

Once the same Role has two successive published handoffs, Relay shows what materially changed between service periods: what was **Added** and what was **Changed**. The incoming Role Holder sees what is different at a glance, with the original handoffs and sources still attached.

## Built for Real Leadership Transitions

Relay works with the mixed material student leaders already use:

- transition notes and role guides
- event plans and checklists
- calendars and annual timelines
- budgets and financial procedures
- policies, constitutions, and forms
- contact lists and resource directories
- meeting notes and lessons learned
- spreadsheets
- voice explanations
- typed context

This mirrors what universities already encourage outgoing officers to transfer: responsibilities, important tasks, key contacts, financial information, records, documents, and outstanding work.

## Trust and Control

Relay is designed so AI assists the handoff without becoming the authority.

- AI-generated knowledge always requires human review
- published handoffs are immutable historical records
- approved knowledge retains source provenance
- Ask Relay is grounded in published, approved knowledge
- raw Captures and working documents are never exposed as published knowledge
- access is scoped by Organization and Role
- database authorization and Row Level Security protect organization data
- authentication secrets are excluded from extracted handoff knowledge

## Relay Plus

Relay Plus is an annual organization plan managed through [RevenueCat](https://www.revenuecat.com/). Subscription status is verified by Relay's backend, not trusted from the client.

| | Free | Relay Plus |
|---|---|---|
| Active Roles | Limited | Multiple |
| Handoff history | Limited | Expanded |
| Organization Memory | ❌ | ✅ |
| Continuity across service periods | ❌ | ✅ |
| Document allowance | Standard | Larger |
| Ask Relay allowance | Standard | Larger |

Existing approved knowledge and published handoffs are preserved if an Organization later returns to the Free plan.

## Technology

| Layer | Technology | Role in Relay |
|---|---|---|
| Mobile app | Expo, React Native, TypeScript | Cross-platform app |
| Backend | Supabase | Auth, database, storage, Row Level Security |
| Document parsing | Unstructured | Extracts content from uploaded documents |
| Retrieval | Astra DB, BM25F | Powers grounded answers in Ask Relay |
| Subscriptions | RevenueCat | Relay Plus billing and entitlements |
| AI | Provider-neutral LLM integration | Organizes Captures and answers questions |

## Repository Map

```text
.
├── assets/
│   ├── brand/                  # Editable Relay brand artwork
│   └── images/                 # App icons, splash image, and favicon
├── patches/                    # Required dependency patches applied after install
├── public/.well-known/         # Android verified-link metadata
├── src/
│   ├── app/                    # Expo Router screens and route layouts
│   ├── components/ui/          # Shared interface components
│   ├── features/
│   │   ├── auth/               # Authentication and session UI
│   │   ├── billing/            # RevenueCat subscription state
│   │   ├── notifications/      # Push registration and routing
│   │   └── relay/              # Capture, handoff, Ask, and memory domain logic
│   ├── lib/                    # Shared service clients
│   ├── theme/                  # Design tokens
│   └── types/                  # Generated database and domain types
├── supabase/
│   ├── functions/
│   │   ├── _shared/            # Shared retrieval, LLM, and workflow logic
│   │   └── */index.ts          # Deployed Edge Function entry points
│   ├── migrations/             # Versioned schema, RLS, and database functions
│   ├── tests/database/         # Database policy and workflow tests
│   └── config.toml             # Local Supabase configuration
├── .env.example                # Public client environment template
├── app.json                    # Expo application configuration
├── eas.json                    # EAS build and deployment profiles
├── package.json                # Dependencies and development commands
├── tsconfig.json               # TypeScript configuration
└── vitest.config.mts           # Unit-test configuration
