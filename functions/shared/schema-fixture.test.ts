import { describe, it, expect } from 'vitest';

import { functionBody, tableBody } from './__fixtures__/schema';

describe('schema fixture matchers', () => {
  describe('functionBody', () => {
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
