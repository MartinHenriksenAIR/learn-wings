# 02 — Codebase Discovery

## Commands / Searches Performed
All searches ran against `/Users/thedawgctor/Desktop/tempfuk/learn-wings`, excluding `node_modules`, `.git`, `dist`, `build`.

```bash
grep -r "lovable" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.toml" --include="*.yml"
grep -r "supabase" (case-insensitive)
grep -r "functions.invoke"
grep -r "/functions/v1"
grep -r "VITE_SUPABASE"
grep -r "createClient"
grep -r "grade-quiz\|generate-certificate\|delete-user\|send-invitation-email\|azure-upload-url\|azure-view-url\|azure-delete-blob\|generate-compliance-report\|azure-document-upload-url\|test-smtp-connection"
grep -r "RESEND_API_KEY\|AZURE_STORAGE_ACCOUNT"
grep -r "can_user_access_lms_asset\|quiz_options\|is_correct\|generateSasToken\|Deno.env\|Deno.connect"
grep -rn "supabase\.(from|rpc|auth|storage|channel|realtime)" src/
grep -niE "supabase|lovable" DEPLOYMENT_SUMMARY.md AZURE_DEPLOYMENT_GUIDE.md QUICK_START.md .lovable/plan.md
```

## Repository Structure (Key Areas)
```
learn-wings/
├── .env                          [SUPABASE env vars — 3 vars]
├── .lovable/plan.md              [Lovable project config]
├── package.json                  [@supabase/supabase-js runtime dep; lovable-tagger devDep]
├── vite.config.ts                [lovable-tagger componentTagger imported + used in dev]
├── supabase/
│   ├── config.toml               [Supabase project + 10 function configs]
│   ├── migrations/               [30+ SQL migration files, Supabase format]
│   └── functions/
│       ├── grade-quiz/index.ts
│       ├── generate-certificate/index.ts
│       ├── delete-user/index.ts
│       ├── send-invitation-email/index.ts
│       ├── azure-upload-url/index.ts
│       ├── azure-view-url/index.ts
│       ├── azure-delete-blob/index.ts
│       ├── generate-compliance-report/index.ts
│       ├── azure-document-upload-url/index.ts
│       ├── test-smtp-connection/index.ts
│       └── seed-mock-users/index.ts  [bonus function, not in main 10]
├── src/
│   ├── integrations/supabase/
│   │   ├── client.ts             [Supabase client singleton]
│   │   └── types.ts              [Auto-generated DB types, 2000+ lines]
│   ├── lib/
│   │   ├── config.ts             [PLATFORM_BASE_URL=ai-uddannelse.dk; getInviteLink()]
│   │   └── sendInvitationEmail.ts [calls supabase.functions.invoke('send-invitation-email')]
│   ├── pages/
│   │   ├── learner/CoursePlayer.tsx     [3 invoke calls: azure-view-url×2, grade-quiz]
│   │   ├── learner/Dashboard.tsx       [1 invoke: generate-certificate]
│   │   ├── platform-admin/CourseEditor.tsx [1 invoke: azure-delete-blob]
│   │   ├── platform-admin/PlatformSettings.tsx [1 invoke: test-smtp-connection]
│   │   └── org-admin/OrgAnalytics.tsx  [1 raw fetch: generate-compliance-report]
│   └── components/
│       ├── platform-admin/UserDetailDialog.tsx [1 raw fetch: delete-user]
│       ├── platform-admin/QuizEditorDialog.tsx [RPC: get_quiz_options_with_answers]
│       └── ui/
│           ├── azure-video-upload.tsx  [2 invokes: azure-view-url, azure-upload-url]
│           └── azure-document-upload.tsx [1 invoke: azure-document-upload-url]
└── .github/workflows/
    ├── main_func-ai-education-migration.yml [Azure Functions CI/CD]
    ├── azure-static-web-apps-black-forest-0d7f96c03.yml [SWA CI/CD]
    └── codeql.yml [Security scanning]
```

## Files With Active Runtime Dependencies

| File | Dependency Type | Details |
|------|---------------|---------|
| src/integrations/supabase/client.ts | runtime — SDK init | createClient, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY |
| src/integrations/supabase/types.ts | runtime — types | Database type used app-wide for type safety |
| src/lib/sendInvitationEmail.ts | runtime — call site | supabase.functions.invoke('send-invitation-email') |
| src/pages/learner/CoursePlayer.tsx | runtime — call sites | azure-view-url (×2), grade-quiz |
| src/pages/learner/Dashboard.tsx | runtime — call site | generate-certificate |
| src/pages/platform-admin/CourseEditor.tsx | runtime — call site | azure-delete-blob |
| src/pages/platform-admin/PlatformSettings.tsx | runtime — call site | test-smtp-connection |
| src/pages/org-admin/OrgAnalytics.tsx | runtime — call site | generate-compliance-report (raw fetch) |
| src/components/platform-admin/UserDetailDialog.tsx | runtime — call site | delete-user (raw fetch) |
| src/components/ui/azure-video-upload.tsx | runtime — call sites | azure-view-url, azure-upload-url |
| src/components/ui/azure-document-upload.tsx | runtime — call site | azure-document-upload-url |
| supabase/functions/*/index.ts (×11) | runtime — implementations | All edge function implementations |

## Files With Config / Deployment Dependencies

| File | Type | Detail |
|------|------|--------|
| .env | config | 3 VITE_SUPABASE_* vars |
| supabase/config.toml | config | project_id, 10 function configs (verify_jwt=false) |
| package.json | package | @supabase/supabase-js (runtime), lovable-tagger (devDep) |
| vite.config.ts | deployment | lovable-tagger componentTagger import |
| .github/workflows/main_func-ai-education-migration.yml | deployment | Deploys to func-ai-education-migration from repo root |
| .github/workflows/azure-static-web-apps-*.yml | deployment | Deploys SPA to SWA |

## Frontend Direct SDK Usage (supabase.auth / supabase.from / supabase.storage / supabase.rpc)

**Search:** `grep -rn "supabase\.(from|rpc|auth|storage|channel|realtime)" src/`

This is a distinct category from function.invoke call sites. These files use `@supabase/supabase-js` directly for auth, DB reads, storage, and RPCs — they are NOT part of the edge function migration path and were not in the initial call site inventory.

### Auth (supabase.auth.*)
| File | Methods Used |
|------|-------------|
| src/hooks/useAuth.tsx | getSession, onAuthStateChange, signOut |
| src/pages/Login.tsx | signInWithPassword |
| src/pages/Signup.tsx | signUp |
| src/pages/ForgotPassword.tsx | resetPasswordForEmail |
| src/pages/ResetPassword.tsx | updateUser |
| src/pages/Settings.tsx | updateUser, getUser |
| src/lib/community-api.ts | getUser |
| src/lib/ideas-api.ts | getUser |
| src/pages/learner/CoursePlayer.tsx | getUser |
| src/pages/org-admin/OrgAnalytics.tsx | getUser |
| src/pages/platform-admin/CourseEditor.tsx | getUser |

**Impact:** `src/hooks/useAuth.tsx` is the central auth hook consumed throughout the app. Replacing it requires replacing the auth provider in all 11 files listed. This is the largest single migration surface after the edge functions.

### Direct Database Reads (supabase.from())
| File | Tables |
|------|--------|
| src/pages/learner/CoursePlayer.tsx | lesson_progress, enrollments, quiz_attempts |
| src/pages/learner/Courses.tsx | courses, enrollments |
| src/hooks/usePlatformSettings.tsx | platform_settings |
| src/pages/org-admin/OrgAnalytics.tsx | org_memberships, enrollments, quiz_attempts |
| src/pages/org-admin/OrgSettings.tsx | organizations |
| src/pages/org-admin/OrgUsers.tsx | org_memberships, profiles |
| src/pages/platform-admin/CoursesManager.tsx | courses |
| src/pages/platform-admin/CourseEditor.tsx | courses, lessons, modules, quiz_questions, quiz_options |
| src/pages/platform-admin/OrganizationsManager.tsx | organizations |
| src/lib/ideas-api.ts | (ideas-related tables) |
| src/components/org-admin/EnrollUserDialog.tsx | enrollments |
| src/components/org-admin/OrgMembersTab.tsx | org_memberships, profiles |

**Impact:** 12 files make direct database reads. These must be converted to API calls to the replacement Azure Functions (or new endpoints created). The current RLS policies enforced by Supabase on these tables must be enforced in Azure Functions instead.

### Storage (supabase.storage.*)
| File | Usage |
|------|-------|
| src/components/ui/file-upload.tsx | upload to Supabase Storage |
| src/lib/storage.ts | storage abstraction layer |
| src/pages/org-admin/OrgAnalytics.tsx | getPublicUrl |
| src/pages/platform-admin/OrganizationDetail.tsx | storage operations |
| src/pages/platform-admin/OrganizationsManager.tsx | storage operations |

**Impact:** `src/lib/storage.ts` is an abstraction layer — replacing it may cascade to other consumers. Supabase Storage blobs must migrate to Azure Blob Storage (`staieducationmigration`). Non-Azure-blob files (e.g., org logos) need migration target decision.

### Additional RPC (supabase.rpc())
| File | RPC |
|------|-----|
| src/components/platform-admin/QuizEditorDialog.tsx | get_quiz_options_with_answers |
| src/pages/platform-admin/OrganizationDetail.tsx | get_invitation_link_id |

**Impact:** Both RPCs must be implemented as Azure Function endpoints or direct DB query wrappers.

---

## Files With Documentation References (Confirmed)

| File | Reference Count | Details |
|------|----------------|---------|
| README.md | 4 | lovable.dev documentation links |
| AZURE_DEPLOYMENT_GUIDE.md | ~25 | VITE_SUPABASE_* as GitHub Actions secrets, `supabase/functions/` deploy commands, migration run commands, Supabase CLI setup |
| QUICK_START.md | ~3 | `supabase/migrations/*.sql` paths, VITE_SUPABASE env vars |
| DEPLOYMENT_SUMMARY.md | ~1 | Supabase Edge Functions referenced as current backend |

**Note:** Doc files do not block production but must be updated to avoid misleading developers after migration.

## Package / Lockfile Findings
- `package.json` deps: `@supabase/supabase-js: ^2.93.1` (RUNTIME — must be removed)
- `package.json` devDeps: `lovable-tagger: ^1.1.13` (DEV ONLY — must be removed)
- `bun.lock`: 7 Supabase refs, 2 Lovable refs
- `package-lock.json`: 18 Supabase refs, 27 Lovable refs
- Both lockfiles will need regeneration after dependency removal

## Database / RPC Findings
- 30+ migration SQL files in `supabase/migrations/` — Supabase-format PostgreSQL
- RPC `can_user_access_lms_asset(p_user_id, file_path)` — defined in migration, called in azure-view-url
- RPC `user_can_access_quiz(p_quiz_id)` — called in grade-quiz
- RPC `get_quiz_options_for_learner` — called from CoursePlayer.tsx (safe, no is_correct)
- RPC `get_quiz_options_with_answers` — called from QuizEditorDialog.tsx (admin)
- Table `quiz_options.is_correct` — service-role only; must never reach browser

## Notable Deviations from DeepWiki Hypotheses
1. **grade-quiz CORS**: DeepWiki said Lovable domains. Reality: `*` wildcard CORS.
2. **generate-compliance-report CORS**: DeepWiki implied Lovable domains. Reality: `*` wildcard CORS.
3. **test-smtp-connection**: No auth at all (CORS `*`, no JWT check). DeepWiki didn't flag this auth gap.
4. **send-invitation-email invite allowlist**: Two Lovable domains in allowlist — but frontend `getInviteLink()` now uses `ai-uddannelse.dk`. Lovable entries are dead code but still block legitimate non-Lovable, non-ai-uddannelse.dk origins.
5. **seed-mock-users**: An 11th function not in DeepWiki list. Has CORS `*` and no auth — admin-only seeding tool.
6. **CoursePlayer.tsx**: azure-view-url called at both line 208 AND 233 (video + documents), not just 208.

## Gaps
- `src/integrations/supabase/types.ts` full contents not line-scanned (2000+ lines) but type name references confirmed
- `DEPLOYMENT_SUMMARY.md`, `AZURE_DEPLOYMENT_GUIDE.md`, `QUICK_START.md` — reference count confirmed (see doc table above); line-by-line audit not performed
- No existing tests found for any of the 10 edge functions (only `src/test/example.test.ts` exists)
- `src/lib/storage.ts` — full contents not read; may abstract additional Supabase Storage operations not catalogued above
- `src/lib/community-api.ts`, `src/lib/ideas-api.ts` — full contents not read; may make additional `supabase.from()` calls beyond `supabase.auth.getUser`
