/**
 * Translation-key scanner for the #300 drift gate — see `translation-keys.test.ts`.
 *
 * Uses the TypeScript compiler API rather than a regex sweep, matching the
 * approach `routes-gate-scanner.ts` takes: `ts.createSourceFile` parses the
 * source and a visitor inspects only call expressions, so a `t(` mentioned in a
 * comment or embedded in a string can never be mistaken for a real call site.
 *
 * Only *statically known* keys are reported. A key assembled at runtime
 * (`t(\`foo.${id}\`)`, `t(item.labelKey)`) cannot be checked against the locale
 * files without executing the app, so it is skipped rather than guessed at.
 */
import * as ts from 'typescript';

export interface TranslationKeyHit {
  /** The literal key passed as `t()`'s first argument. */
  key: string;
  /** 1-based line of the call site. */
  line: number;
  /** 1-based column of the call site. */
  column: number;
}

/** Matches `t(...)` and `i18n.t(...)` / `i18next.t(...)` — the two shapes in use. */
function isTranslationCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 't';
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 't';
  return false;
}

/**
 * Scan a TS/TSX source and return every `t()` call whose key is a static string
 * literal, each with its line/column from AST position.
 */
export function scanTranslationKeys(
  source: string,
  fileName = 'input.tsx',
): TranslationKeyHit[] {
  const scriptKind = fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );
  const hits: TranslationKeyHit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTranslationCall(node)) {
      const [first] = node.arguments;
      // A plain string or a backtick string with no `${…}` is static; anything
      // else (template expression, identifier, ternary, array) is not.
      if (
        first &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
      ) {
        const { line, character } = sf.getLineAndCharacterOfPosition(
          node.getStart(sf),
        );
        hits.push({ key: first.text, line: line + 1, column: character + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return hits;
}
