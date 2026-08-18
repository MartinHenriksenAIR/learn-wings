# Terminology glossary (en/da)

Canonical source of truth for **user-facing** wording across the platform, in both
English and Danish. When UI copy and this file disagree, this file wins — fix the copy.

## Rules

1. **User and License are distinct.** A person who can sign in is a **User** (da
   **Bruger**); the paid capacity unit that entitles one person is a **License** (da
   **Licens**) — one user consumes one license (the org-wide cap). "Member" / "Medlem"
   (the earlier fused term, #465) and "seat" / "plads" are retired from all copy.
2. **Heading == menu label.** Every page's `<h1>` reads exactly as its sidebar nav item.
3. **Internal code names are out of scope** (see the last section).

## Core terms

| Concept | English | Danish | Notes |
|---|---|---|---|
| A person who can sign in | **User** | **Bruger** | Replaces "Member" / "Medlem" for people (earlier "seat" / "plads"). |
| Paid capacity unit | **License** | **Licens** | One user = one license; the org-wide cap. Replaces "Member" / "seat" for capacity. |
| Capacity cap | **License limit** | **Licensgrænse** | Was "Member limit" / "Medlemsgrænse". Org list capacity column, edit-org field, limit-reached states. |
| Usage against the cap | **Licenses used** / **{used} of {limit} licenses** | **Licenser brugt** / **{used} af {limit} licenser** | Was "Members used" / "Medlemmer brugt". |
| Buying capacity | **License pricing**, **Request more licenses** | **Licenspriser**, **Anmod om flere licenser** | Was "Member pricing" / "Medlempriser". Applies to pricing + invoice copy. |

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
| People in an org (nav + heading) | **Users** | **Brugere** | Was "Organization Members" / "Organisationsmedlemmer" (#465). Holds the user list, training assignment, and Learning progress. Not "Team Members". |
| Org reporting area (nav + heading) | **Organization** | **Organisation** | Overview + Courses reporting; people moved to Users/Brugere in #465. Not "Analytics". |
| Org-admin nav group | **Administration** | **Administration** | Umbrella group over Users, Organization, and Settings (#465). |
| Idea backlog page | **Ideas Management** | **Idéhåndtering** | Heading now matches the nav label (was "Ideas Overview" / "Idéoversigt"). |

## Kept unchanged (internal code names — NOT user-facing)

Identifiers, not copy — only rendered **values** follow this glossary, never keys or symbol names:

- DB / SQL: `seat_limit`, `seat_requests`, `org_memberships`, `member_count`
- Backend: `functions/**/seats.ts` and related handlers
- i18n **keys**: `seats.*`, `seatRequests.*`, `seatLimit*`, `seatsUsed`, `seatPricing`,
  `editSeatLimit`, `colSeats`, `analytics.tabs.members`, `analytics.members.*`,
  `analytics.totalMembers` (their **values** follow this glossary; the keys stay)
- React / hooks: `SeatUsageBar`, `SeatUsageNote`, the `SeatUsage` type, `usedSeats` /
  `seatUsage` props, the `seat-usage-bar` test IDs, `OrgMembersTab`, `useOrgMemberships`
- Interpolation variables: `{{seats}}` (a count placeholder)
