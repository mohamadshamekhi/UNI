# Phase 5 — News and events (sections 10–11, NWS-01..15, EVT-01..12)

Gate: a post with a restricted audience is visible only to that audience — in feeds, search, direct links,
attachments and notifications.

## News

**Audience and publishers are separate (NWS-02).** Who may *see* a post is its `audience`; who may *write,
approve or publish* in a channel is the channel's membership (plus tenant-wide `news.*` permissions).

| Table | Purpose |
|---|---|
| `news_channels` | owned by the tenant or a unit; publishing policy `direct` / `single` / `multi` (+ approvals needed) |
| `news_channel_members` | per-channel roles `author`, `approver`, `publisher` — a student can publish in one channel only (NWS-04) |
| `news_posts` | slug, title, summary, sanitised body, cover, category, tags, source, author, status, audience, `publish_at`, `expire_at`, version |
| `news_post_versions` | snapshot per saved version (NWS-11) |
| `news_approvals` | approve / return decisions per version (NWS-05) |
| `news_events` | history |

Audience (`jsonb`, OR of rules): `public`, `members`, `units[{id, tree}]`, `roles[]`, `memberships[]`.
Evaluated in SQL for every list, search and detail query; a post the viewer may not see is reported as
missing (no title leak, NWS-10). Attachments and covers of restricted posts are served only after the same
check (NWS-09); public posts have an anonymous file route. Bodies are sanitised on write with an allow-list
(no scripts, styles, event handlers or `javascript:` links, NWS-08).

Status: `draft → pending_approval → approved → scheduled | published → archived`, `deleted` (soft). A minute
sweep publishes at `publish_at` and archives at `expire_at` (NWS-07). Unpublishing needs `news.unpublish` and a
reason (NWS-12). Optional in-app notification to the audience on publish (NWS-13; no SMS by default — cost).
Public posts get page metadata; restricted posts are `noindex` (NWS-14).

## Events

| Table | Purpose |
|---|---|
| `events` | title, description, category, organiser unit, start/end, place / online link, cover, status, **visibility** (`own_tenant` / `selected_tenants` / `public`), **registration rule** (separate from visibility, EVT-02/03), capacity, waitlist, deadline, approval, cancellation allowed, custom form (EVT-04), placeholders for fee, certificate, paper submissions (EVT-11), linked news post (EVT-12) |
| `event_registrations` | one active registration per user (EVT-07, unique), status `registered / pending / approved / rejected / cancelled / waitlisted`, answers, short code for a future QR, attendance |

Registration rule kinds: `members` of the organising tenant, `roles`, `units`, `tenants` (members of listed
universities), `authenticated` (anyone signed in). Capacity counts active registrations; when full the user is
wait-listed (if enabled) and promoted when someone cancels. Organisers (`event.manage` in the organiser unit's
scope) see registrations and export them as CSV (UTF-8 with BOM, opens in Excel; EVT-06) and mark attendance.

## Call for papers (EVT-11, added after phase 6)

An event can open a call for papers on one of the university's paper tracks (`paper_track_id`), with
its own deadline (`paper_deadline`) and submission rule (`paper_rule`: all members, chosen units or
roles). Seeing the event, registering and submitting a paper stay three separate rules. A conference
paper is an ordinary paper with `event_id`: it always uses the event's track (and so its review mode),
and the deadline is checked on create and on submit. Papers are reviewed inside the organising
university, so only its members can submit; guests from other universities can see and register.
