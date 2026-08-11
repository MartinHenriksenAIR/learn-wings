# Terminology glossary (en/da)

Canonical source of truth for **user-facing** wording across the platform, in both
English and Danish. When UI copy and this file disagree, this file wins — fix the copy.

This extends the naming conventions in `AIEDU/CLAUDE.md` ("Organization Members" not
"Team Members"; "Organization" not "Analytics") and **supersedes "Course Overview"**
(now "Course Catalog" / "Kursuskatalog").

## Rules

1. **One word for a membership.** A paid capacity unit and a person are the same
   concept: a **Member** (da **Medlem**). The word "seat" / "plads" is retired from all
   user-facing copy — including capacity, limit, requests, and **pricing / invoice**
   screens.
2. **Heading == menu label.** Every page's `<h1>` reads exactly as its sidebar nav item.
3. **Internal code names are out of scope** (see the last section) — only rendered text
   follows this glossary.

## Core terms

| Concept | English | Danish | Notes |
|---|---|---|---|
| A person / capacity unit | **Member** | **Medlem** | Replaces "seat" / "plads" everywhere user-facing. A seat *is* a membership. |
| Capacity cap | **Member limit** | **Medlemsgrænse** | Was "seat limit" / "pladsgrænse". Used for the org list capacity column, edit-org field, and limit-reached states. |
| Usage against the cap | **Members used** / **{used} of {limit} members** | **Medlemmer brugt** / **{used} af {limit} medlemmer** | Was "seats used" / "pladser brugt". |
| Buying capacity | **Member pricing**, **Request more members** | **Medlemspriser**, **Anmod om flere medlemmer** | Was "seat pricing" / "pladspriser". Applies to pricing + invoice copy. |

## Learning navigation names

| Concept | English | Danish | Notes |
|---|---|---|---|
| Course browsing page | **Course Catalog** | **Kursuskatalog** | Supersedes "Course Overview" / "Kursusoversigt". Nav label and page heading. |
| Personal learning home | **My Training** | **Min Træning** | Page delivered by #364; name reserved here. |
| Learner nav group | **Learning** | **Læring** | Sidebar group label. |
| Social area (nav group) | **Community** | **Fællesskab** | Sidebar **group label** — the umbrella over the destinations below. |
| Discussion feed | **Discussions** | **Diskussioner** | Community post feed (org + global). Nav pill + page heading. Renamed from "Community/Fællesskab" in #344 so the feed isn't the same word as its own group. |
| Events destination | **Events** | **Arrangementer** | Nav pill + page heading. Danish "Arrangementer" matches the "Nyt arrangement" create button; page covers events + office hours. Promoted from a community tab in #344. |
| Resources destination | **Resources** | **Ressourcer** | Nav pill + page heading. Promoted to a top-level destination in #344; sits under Fællesskab when community is on, falls back into Læring when it's off. |
| Tips area | **Tips & Tricks** | **Tips & Tricks** | Untranslated; page delivered by #366. |

## Existing conventions (carried forward)

| Concept | English | Danish | Notes |
|---|---|---|---|
| People in an org | **Organization Members** | **Organisationsmedlemmer** | Not "Team Members". |
| Org data area | **Organization** | **Organisation** | Not "Analytics". |
| Idea backlog page | **Ideas Management** | **Idéhåndtering** | Heading now matches the nav label (was "Ideas Overview" / "Idéoversigt"). |

## Kept unchanged (internal code names — NOT user-facing)

These are identifiers, not copy, and are deliberately left as "seat":

- DB / SQL: `seat_limit`, `seat_requests`
- Backend: `functions/**/seats.ts` and related handlers
- i18n **keys**: `seats.*`, `seatRequests.*`, `seatLimit*`, `seatsUsed`, `seatPricing`,
  `editSeatLimit`, `colSeats` (their **values** follow this glossary; the keys stay)
- React: `SeatUsageBar`, `SeatUsageNote`, the `SeatUsage` type, `usedSeats` / `seatUsage`
  props, and the `seat-usage-bar` test IDs
- Interpolation variables: `{{seats}}` (a count placeholder)
