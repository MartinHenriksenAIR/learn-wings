---
id: "ADR-0016"
title: "Content Localization Strategy"
status: accepted
date: 2026-07-23
deciders: ['MartinHenriksenAIR']
tags: ['i18n', 'content', 'courses', 'community', 'email', 'architecture']
policy:
  rationales: ['Structured teaching content (courses and their lessons/modules/quizzes) is localized as per-language editions grouped by courses.course_group_id — the only surface that segments the audience by language: learners and org-admins see only the edition matching their preferred_language, platform admins see all editions, and analytics aggregate a group into one logical course', 'Communal and announcement content (community feed, webinar/marketing pages) is a single shared artifact shown to everyone regardless of preferred_language — no per-language editions and no language-based filtering; authors write in whichever language they choose', 'System-generated documents (transactional emails, the AI Act compliance PDF) use one localized template whose fixed strings render in the recipient/viewer preferred_language via the same i18n mechanism as the UI — never separately-authored per-language copies']
approval_date: 2026-07-23
approval_notes: "Decision recorded for #187. Ratifies the courses model already shipped by #191 (per-course language + per-language visibility) and #213 (course_group_id grouping + analytics aggregation), and extends a coherent classification rule to every other authored-content surface. Product intent confirmed with the owner: every course is offered in both Danish and English, but the audience is never split by language anywhere except courses."

---

## Context

#119 / PR #186 made the **UI chrome** Danish-default through the i18next locale JSON (`en`/`da`). That covers translated *interface strings* only — buttons, menus, labels. Authored **content** is not driven by the locale JSON, and #187 flagged that there was no recorded principle for how content should be localized across the surfaces that carry it: course material (#123), the AI Act compliance PDF (#71), a future webinar/announcement page (#125), transactional emails, and any future authored content.

Since #187 was filed (2026-07-20), two PRs shipped a concrete model for **courses** specifically: #191 added a per-course `language` (`en`/`da`) plus per-language visibility for learners and org-admins, and #213 added `courses.course_group_id` (with a unique index enforcing at most one edition per language per group) plus analytics that aggregate the language editions of one course into a single logical row. So the courses answer already exists in code; what is missing is a single principle that tells **every** current and future content surface how to localize, consistent with that model.

The controlling product intent, confirmed with the owner while recording this ADR: every course is offered in **both** Danish and English, **but the audience must not be segmented by language anywhere except courses** — the community feed and webinar pages are shared spaces for everyone, and system-generated documents follow the reader's language rather than existing as duplicate copies.

## Decision

Authored content is not one thing. It falls into three categories, each localized by a different mechanism. New content surfaces are classified into one of these before they are built.

**1. Structured teaching content → per-language editions.** Courses and their nested `course_modules` / `lessons` / `quizzes`. Each language is its own `courses` row carrying a single `language` (`en`/`da`); the language editions of one course are linked by `courses.course_group_id` (at most one edition per language per group, enforced by `uq_courses_group_language`). Platform admins see and author all editions; **org-admins and learners see only the edition matching their active UI language** (`i18n.resolvedLanguage`, sent per request; #191) — deliberately the UI language, **not** the stored `preferred_language`. Analytics aggregate a group into **one representative logical course** — enrolment and completion combined across editions, the representative title/level following the viewer's app (UI) language (#213). Lessons, modules, and quizzes inherit their parent course's language and are never independently localized. **This is the only surface on the platform where the audience is segmented by language.**

**2. Communal & announcement content → single shared artifact.** The community feed (posts and comments) and webinar/marketing pages (#125). One artifact, visible to **everyone regardless of `preferred_language`** — no per-language editions and no language-based filtering. Authors write in whichever language they choose (Danish or English), and readers of both languages land on the same feed and the same page. Rationale: community content is inherently mixed-language, user-generated, and peer-to-peer; the audience is small and communal, so splitting it by language would fracture the space and hide activity from half the users. Announcement pages are authored once and shown to all.

**3. System-generated documents → single localized template.** Transactional emails (e.g. the invitation email) and the AI Act compliance PDF. These are assembled by code from data plus fixed boilerplate. There is **one template**; its fixed strings render in the reader's language — the recipient's stored `profiles.preferred_language` for a server-sent email (as #193's seat-request emails already do), or the requesting user's language for the on-demand PDF — while the variable data (names, org, completion numbers, dates) is language-neutral. There are **no** separately-authored per-language copies.

**Classification rule for future content:** if a human authors the whole thing, a learner browses and picks it, and the languages carry genuinely different prose → **editions** (courses only, today). If it is communal or an announcement shown to all → **shared**. If the system assembles it from data plus fixed labels → **localized template**. Two related language signals are in play: `i18n.resolvedLanguage` (the active, browser-derived UI language) drives the UI and UI-rendered catalog content (category 1), while the stored `profiles.preferred_language` drives server-generated documents (category 3, e.g. #193's emails). These can currently diverge for a new user (`preferred_language` defaults to `en` and is never initialized); #226 aligns them so a user's stored preference matches their browser-derived UI language. Category 2 ignores both.

## Consequences

Every content-producing surface now has an unambiguous localization mechanism, so the #187 gap is closed and future surfaces cannot drift into ad-hoc choices. Per surface:

- **Courses (#123):** already conformant via #191/#213 — author the initial courses as paired Danish + English editions sharing a `course_group_id`.
- **Community feed:** already conformant — it carries no language dimension and filters nobody; no change.
- **Webinar / marketing page (#125):** build as a single shared page; the author picks the language(s); no per-language editions and no filtering.
- **Invitation email:** currently hardcoded `<html lang="da">` and ignores the recipient — must be reworked to render in the **invitee's** `preferred_language` (category 3). Tracked by #225, which must also resolve the language source for invitees who have no `profiles` row yet (fall back to the platform default vs. use the inviter's language).
- **AI Act compliance PDF (#71):** currently hardcoded `en-US` — must render in the **requesting user's** language (their UI language at request time, since it is generated on demand) (category 3). Tracked by #71 (its own branding/layout work applies this rule).

Costs and risks: category 1 doubles authoring effort for courses — accepted, because the product deliberately offers every course in both languages. Category 3 requires the email and PDF templates to be threaded through the i18n string layer, which they are not today, so each is a real (small) implementation task in its own issue. The classification rule must be consulted whenever a new content surface is added, or the three categories drift back into per-surface improvisation — the same failure mode #187 was raised to prevent.

## Alternatives

1. **One uniform mechanism (editions everywhere)** — rejected: maintaining two hand-authored copies of every transactional email or generated PDF is pointless duplication when the only difference is boilerplate the i18n layer already handles, and real teaching prose cannot be reduced to a string table.
2. **Danish-only authored content** — rejected: the product deliberately offers every course in both Danish and English, so a single-language content model does not fit courses.
3. **Extend editions/language-filtering to community and webinars too** — rejected by explicit product decision: communal spaces must stay shared, so a Danish speaker and an English speaker see the same feed and the same webinar page; fragmenting them by language would fracture a small community.
4. **A single per-artifact `language` field everywhere with fallback (the "mixed-language catalog" option floated in #187)** — superseded: courses already went further (editions + grouping via #191/#213), while communal content needs no language field at all, so a blanket per-artifact field would be both insufficient for courses and unnecessary elsewhere.
