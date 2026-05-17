# 08 — Test Strategy

## Existing Tests Found
- `src/test/example.test.ts` — placeholder example test only
- `src/test/setup.ts` — Vitest setup
- **No tests exist for any of the 10 edge functions**
- **No tests exist for any frontend call site**

## Testing Stack (Existing)
- Vitest + @testing-library/react (already in devDependencies)
- jsdom for DOM simulation

## Testing Stack (Proposed Additions)
- `supertest` or `@azure/functions-testing` for Azure Function integration tests
- `nock` or `msw` for mocking external services (Resend, Azure Blob)
- `pg-mem` for in-memory PostgreSQL testing (or use test DB on Azure PostgreSQL)

## No Local Emulators
Do not use:
- Supabase local
- Azurite (Azure Storage emulator)
- Docker Compose
- Azure Functions Core Tools emulator in tests

All integration tests run against real Azure test resources or use mocking.

---

## Test Categories Required

### Category 1: Contract Tests (per function)
Verify each replacement function preserves the exact API contract.

**grade-quiz** — `functions/grade-quiz/grade-quiz.test.ts`:
```ts
describe('POST /api/grade-quiz', () => {
  it('returns score/passed/passing_score/correct_count/total_questions', async () => {
    const res = await request(app).post('/api/grade-quiz')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ quiz_id: knownQuizId, answers: { [q1Id]: correctOptionId } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      score: expect.any(Number),
      passed: expect.any(Boolean),
      passing_score: expect.any(Number),
      correct_count: expect.any(Number),
      total_questions: expect.any(Number),
    });
  });
  it('CRITICAL: response does not contain is_correct field', async () => {
    const res = await request(app).post('/api/grade-quiz')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ quiz_id: knownQuizId, answers: {} });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('is_correct');
  });
  it('returns 401 with no auth', async () => {
    const res = await request(app).post('/api/grade-quiz').send({ quiz_id: 'x', answers: {} });
    expect(res.status).toBe(401);
  });
  it('returns 403 when user has no quiz access', async () => { ... });
});
```

**generate-certificate** — binary PDF response:
```ts
it('returns application/pdf with correct headers', async () => {
  const res = await request(app).post('/api/generate-certificate')
    .set('Authorization', `Bearer ${validToken}`)
    .send({ enrollmentId: completedEnrollmentId })
    .buffer(true);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect(res.headers['content-disposition']).toMatch(/attachment; filename="certificate-.+\.pdf"/);
  expect(res.body.length).toBeGreaterThan(0);
});
it('returns 404 for incomplete enrollment', async () => { ... });
it('returns 404 for another user\'s enrollment', async () => { ... });
```

**delete-user**:
```ts
it('deletes user when called by platform admin', async () => { ... });
it('returns 403 for non-admin user', async () => { ... });
it('returns 400 when userId === requesting user', async () => { ... });
it('returns 400 when userId missing', async () => { ... });
```

**send-invitation-email**:
```ts
it('sends email via Resend for platform admin', async () => {
  // mock Resend API
  const res = await request(app).post('/api/send-invitation-email')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: 'test@example.com', orgName: 'TestOrg', role: 'learner', inviteLink: 'https://ai-uddannelse.dk/signup?invite=abc' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});
it('rejects invite link with Lovable domain', async () => {
  const res = await request(app).post('/api/send-invitation-email')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: 'x@x.dk', orgName: null, role: 'learner', inviteLink: 'https://learn-wings.lovable.app/signup?invite=abc' });
  expect(res.status).toBe(500); // or 400
  expect(res.body.success).toBe(false);
});
it('returns 403 for non-admin', async () => { ... });
```

**azure-upload-url**:
```ts
it('returns uploadUrl, blobPath, contentType for platform admin', async () => {
  const res = await request(app).post('/api/azure-upload-url')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ fileName: 'test.mp4', contentType: 'video/mp4' });
  expect(res.status).toBe(200);
  expect(res.body.uploadUrl).toMatch(/https:\/\/staieducationmigration\.blob\.core\.windows\.net\/.+\?sp=cw.+/);
  expect(res.body.blobPath).toBeTruthy();
  expect(res.body.contentType).toBe('video/mp4');
});
it('SAS expires within 35 minutes (30 + 5 skew)', async () => {
  const res = await request(app).post('/api/azure-upload-url')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ fileName: 'test.mp4' });
  const urlParams = new URL(res.body.uploadUrl).searchParams;
  const expiry = new Date(urlParams.get('se')!);
  const maxExpiry = new Date(Date.now() + 35 * 60 * 1000);
  expect(expiry.getTime()).toBeLessThanOrEqual(maxExpiry.getTime());
});
it('returns 403 for non-admin', async () => { ... });
```

**azure-view-url**:
```ts
it('returns viewUrl for enrolled learner', async () => { ... });
it('returns 403 for non-enrolled learner', async () => { ... });
it('platform admin gets viewUrl without enrollment check', async () => { ... });
it('SAS has read-only permission (sp=r)', async () => { ... });
it('SAS expires within 125 minutes (120 + 5 skew)', async () => { ... });
```

**azure-delete-blob**:
```ts
it('returns success for existing blob', async () => { ... });
it('returns success for non-existent blob (404 treated as success)', async () => { ... });
it('returns 403 for non-admin', async () => { ... });
it('SAS has delete permission (sp=d)', async () => { ... });
```

**generate-compliance-report**:
```ts
it('returns application/pdf for org admin', async () => {
  const res = await request(app).post('/api/generate-compliance-report')
    .set('Authorization', `Bearer ${orgAdminToken}`)
    .send({ orgId: knownOrgId })
    .buffer(true);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect(res.headers['content-disposition']).toMatch(/attachment; filename="ai-act-compliance-report-.+\.pdf"/);
});
it('returns 403 for learner in same org', async () => { ... });
it('returns 403 for org admin of different org', async () => { ... });
```

**azure-document-upload-url**:
```ts
it('returns blobPath with documents/ prefix', async () => {
  const res = await request(app).post('/api/azure-document-upload-url')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ fileName: 'course.pdf', contentType: 'application/pdf' });
  expect(res.body.blobPath).toMatch(/^documents\//);
  expect(res.body.contentType).toBe('application/pdf');
});
```

**test-smtp-connection**:
```ts
it('returns 403 without auth (unlike current Supabase version)', async () => {
  const res = await request(app).post('/api/test-smtp-connection')
    .send({ host: 'smtp.example.com', port: 587, encryption: 'starttls' });
  expect(res.status).toBe(401); // or 403 — must be auth-gated
});
it('returns success for reachable SMTP server', async () => {
  // mock net.createConnection
  const res = await request(app).post('/api/test-smtp-connection')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ host: 'smtp.gmail.com', port: 587, encryption: 'starttls' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});
it('returns error with message for unreachable host', async () => {
  const res = await request(app).post('/api/test-smtp-connection')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ host: '192.0.2.1', port: 25, encryption: 'none' }); // TEST-NET, unreachable
  expect(res.body.success).toBe(false);
  expect(typeof res.body.error).toBe('string');
});
```

---

### Category 2: Security Tests

```ts
describe('Security: quiz_options.is_correct never exposed', () => {
  it('grade-quiz response body never contains is_correct', async () => { ... });
  it('grade-quiz response body never contains correctOptions array', async () => { ... });
  it('grade-quiz request body does not accept is_correct', async () => { ... });
});

describe('Security: admin-only operations gated', () => {
  it('delete-user requires platform_admin', async () => { ... });
  it('azure-upload-url requires platform_admin', async () => { ... });
  it('azure-delete-blob requires platform_admin', async () => { ... });
  it('azure-document-upload-url requires platform_admin', async () => { ... });
  it('test-smtp-connection requires platform_admin', async () => { ... }); // NEW gate
});

describe('Security: CORS does not include Lovable domains', () => {
  const lovableDomains = [
    'https://learn-wings.lovable.app',
    'https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app',
    'https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com',
  ];
  for (const origin of lovableDomains) {
    it(`rejects CORS from ${origin}`, async () => {
      const res = await request(app)
        .options('/api/grade-quiz')
        .set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).not.toBe(origin);
    });
  }
});

describe('Security: send-invitation-email Lovable domain rejected', () => {
  it('rejects inviteLink with learn-wings.lovable.app', async () => { ... });
});
```

---

### Category 3: Absence Tests (Proving No Supabase/Lovable Remains)

```ts
describe('Codebase absence verification', () => {
  it('no file in src/ imports from @supabase/supabase-js', () => {
    const { execSync } = require('child_process');
    const result = execSync('grep -r "@supabase/supabase-js" src/', { encoding: 'utf8' }).trim();
    expect(result).toBe('');
  });
  it('no file in src/ references VITE_SUPABASE_URL', () => { ... });
  it('no file in src/ calls supabase.functions.invoke', () => { ... });
  it('no file in functions/ references Deno.env', () => { ... });
  it('no file in functions/ references supabase.co', () => { ... });
  it('package.json does not contain @supabase/supabase-js', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies).not.toHaveProperty('@supabase/supabase-js');
  });
  it('package.json does not contain lovable-tagger', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(pkg.devDependencies).not.toHaveProperty('lovable-tagger');
  });
  it('vite.config.ts does not import lovable-tagger', () => { ... });
});
```

---

### Category 4: Negative / Edge Case Tests

```ts
// For all functions:
it('returns 401 when Authorization header is missing', ...)
it('returns 401 when JWT is expired', ...)
it('returns 401 when JWT is malformed', ...)

// For grade-quiz:
it('returns 400 when quiz_id is missing', ...)
it('returns 400 when answers is not an object', ...)
it('returns 0 score correctly when all answers wrong', ...)

// For generate-certificate / generate-compliance-report:
it('handles missing profile gracefully (falls back to email)', ...)
it('handles empty org members', ...)
```

---

## Commands to Run

```bash
# Run all tests
npm run test

# Run with coverage
npm run test -- --coverage

# Run specific function tests
npx vitest run functions/grade-quiz/grade-quiz.test.ts
```

## Commands NOT to Run (and Why)

```bash
# DO NOT run supabase start — requires Docker, local Supabase not needed
# DO NOT run azurite — use real Azure test resources or mocks
# DO NOT run Deno test — Deno runtime not available after migration
```
