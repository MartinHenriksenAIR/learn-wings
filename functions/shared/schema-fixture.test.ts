import { describe, it, expect } from 'vitest';

import { functionBody, tableBody } from './__fixtures__/schema';

// These guard the fixture's own matchers (used by the schema-drift pins in
// course-visibility.test.ts and lms-asset.test.ts). They inject a synthetic
// schema so the extraction logic can be exercised without the real file.
describe('schema fixture matchers', () => {
  describe('functionBody', () => {
    // A prefix-named sibling declared *before* the target must not be matched.
    // A bare `FUNCTION public.<name>` prefix match grabs `<name>_v2`'s body here.
    it('matches the exact function, not a prefix-named sibling', () => {
      const schema = [
        'CREATE OR REPLACE FUNCTION public.foo_v2(x int)',
        'RETURNS boolean AS $$ SELECT false $$;',
        '',
        'CREATE OR REPLACE FUNCTION public.foo(x int)',
        'RETURNS boolean AS $$ SELECT true $$;',
      ].join('\n');
      expect(functionBody('foo', schema).trim()).toBe('SELECT true');
    });

    // `EXECUTE FUNCTION public.<name>()` trigger references also contain the
    // bare `FUNCTION public.<name>` text; the CREATE anchor skips them.
    it('matches the definition, not an EXECUTE reference', () => {
      const schema = [
        'CREATE OR REPLACE FUNCTION public.touch()',
        'RETURNS trigger AS $$ SELECT 1 $$;',
        '',
        'CREATE TRIGGER t BEFORE UPDATE ON public.x',
        '  FOR EACH ROW EXECUTE FUNCTION public.touch();',
      ].join('\n');
      expect(functionBody('touch', schema).trim()).toBe('SELECT 1');
    });

    it('throws a descriptive error when the function is absent', () => {
      expect(() => functionBody('nope', 'CREATE TABLE public.x (\n);')).toThrow(
        /public\.nope not found/,
      );
    });
  });

  describe('tableBody', () => {
    it('matches the exact table, not a prefix-named sibling', () => {
      const schema = [
        'CREATE TABLE public.courses_archive (',
        '  archived boolean',
        ');',
        '',
        'CREATE TABLE public.courses (',
        '  is_published boolean',
        ');',
      ].join('\n');
      expect(tableBody('courses', schema)).toMatch(/is_published boolean/);
      expect(tableBody('courses', schema)).not.toMatch(/archived boolean/);
    });

    it('throws a descriptive error when the table is absent', () => {
      expect(() => tableBody('nope', 'CREATE TABLE public.x (\n);')).toThrow(
        /public\.nope table not found/,
      );
    });
  });
});
