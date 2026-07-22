/**
 * Drift guard: asserts that the frontend i18n question/option keys exactly
 * cover the server module's IDs — no extras, no omissions.
 *
 * The server module (functions/shared/assessment-questions.ts) is pure data
 * with zero azure/pg imports, so it is safe to import directly from frontend
 * tests by design.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — cross-tree import; tsconfig.app.json includes only src/ but noEmit means no rootDir error
import { ASSESSMENT_QUESTIONS } from '../../functions/shared/assessment-questions';
import enJson from './locales/en.json';
import daJson from './locales/da.json';

type LocaleJson = typeof enJson;

function assertQuestionKeyCoverage(locale: LocaleJson, localeName: string) {
  const serverIds = ASSESSMENT_QUESTIONS.map((q: { id: string }) => q.id);
  const localeIds = Object.keys(locale.assessment.questions);

  // Same set, same length — no extras, no omissions.
  expect(
    new Set(localeIds),
    `${localeName}: locale question keys must exactly equal server question IDs`,
  ).toEqual(new Set(serverIds));
  expect(
    localeIds.length,
    `${localeName}: locale question count must equal server question count`,
  ).toBe(serverIds.length);

  // Per-question: option keys must match.
  for (const question of ASSESSMENT_QUESTIONS as Array<{ id: string; options: readonly string[] }>) {
    const localeQ = locale.assessment.questions[question.id as keyof typeof locale.assessment.questions] as
      | { text: string; options: Record<string, string> }
      | undefined;

    expect(localeQ, `${localeName}: missing question entry for "${question.id}"`).toBeDefined();
    if (!localeQ) continue;

    const serverOptions = Array.from(question.options);
    const localeOptions = Object.keys(localeQ.options);

    expect(
      new Set(localeOptions),
      `${localeName} / ${question.id}: option keys must exactly equal server option IDs`,
    ).toEqual(new Set(serverOptions));
    expect(
      localeOptions.length,
      `${localeName} / ${question.id}: option count must equal server option count`,
    ).toBe(serverOptions.length);
  }
}

function assertPersonaAndBlurbKeys(locale: LocaleJson, localeName: string) {
  const expected = new Set(['basic', 'intermediate', 'advanced']);
  expect(
    new Set(Object.keys(locale.assessment.result.personas)),
    `${localeName}: personas keys must be exactly basic/intermediate/advanced`,
  ).toEqual(expected);
  expect(
    new Set(Object.keys(locale.assessment.result.blurbs)),
    `${localeName}: blurbs keys must be exactly basic/intermediate/advanced`,
  ).toEqual(expected);
}

describe('assessment i18n drift guard', () => {
  it('en.json question/option keys exactly cover server IDs', () => {
    assertQuestionKeyCoverage(enJson, 'en');
  });

  it('da.json question/option keys exactly cover server IDs', () => {
    assertQuestionKeyCoverage(daJson as unknown as LocaleJson, 'da');
  });

  it('en.json personas and blurbs keys are exactly basic/intermediate/advanced', () => {
    assertPersonaAndBlurbKeys(enJson, 'en');
  });

  it('da.json personas and blurbs keys are exactly basic/intermediate/advanced', () => {
    assertPersonaAndBlurbKeys(daJson as unknown as LocaleJson, 'da');
  });
});
