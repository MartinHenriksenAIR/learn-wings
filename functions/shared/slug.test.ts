import { describe, it, expect } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Machine Learning')).toBe('machine-learning');
  });

  it('collapses runs of non-alphanumerics to a single hyphen', () => {
    expect(slugify('AI  &  Ethics!!')).toBe('ai-ethics');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  Hello  ')).toBe('hello');
    expect(slugify('---edge---')).toBe('edge');
  });

  it('folds accented Latin characters to ASCII', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('folds Danish letters (å→a, ø→o, æ→ae), any case', () => {
    expect(slugify('Dåb Øst Æble')).toBe('dab-ost-aeble');
  });

  it('keeps digits', () => {
    expect(slugify('GPT 4 Turbo')).toBe('gpt-4-turbo');
  });

  it('returns empty string when no slug-able characters remain', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });
});
