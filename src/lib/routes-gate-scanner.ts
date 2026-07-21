/**
 * Route-literal scanner for the #178 drift gate — see `routes-gate.test.ts`.
 *
 * Uses the TypeScript compiler API instead of a hand-rolled comment/string lexer:
 * `ts.createSourceFile` parses the source, and a visitor inspects only string and
 * template literals. This is correct by construction — comments, regex literals,
 * and identifiers are never string-literal nodes, so a `//` inside a URL or a route
 * word mentioned in prose can never be mistaken for a live reference. Only a
 * literal's *leading* text is tested, so a route word that appears after a `${...}`
 * substitution or mid-string never matches.
 */
import * as ts from 'typescript';

/**
 * A route path literal: a leading `/` immediately followed by a known route path
 * segment, bounded so `/app` never matches `/apple` or `/login-help`. Applied to a
 * literal's cooked *value*, so no quote/backtick bookkeeping is needed.
 */
const ROUTE_SEGMENT =
  /^\/(?:app|login|signup|forgot-password|reset-password)(?![\w-])/;

export interface RouteLiteralHit {
  /** 1-based line of the offending literal. */
  line: number;
  /** 1-based column of the offending literal. */
  column: number;
  /** The literal's leading value that matched a guarded route segment. */
  text: string;
}

/**
 * Scan a TS/TSX source and return every string or template literal whose value
 * starts with a guarded app route path, each with its file:line from AST position.
 */
export function scanRouteLiterals(
  source: string,
  fileName = 'input.tsx',
): RouteLiteralHit[] {
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
  const hits: RouteLiteralHit[] = [];

  const record = (text: string, pos: number) => {
    if (!ROUTE_SEGMENT.test(text)) return;
    const { line, character } = sf.getLineAndCharacterOfPosition(pos);
    hits.push({ line: line + 1, column: character + 1, text });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      record(node.text, node.getStart(sf));
    } else if (ts.isTemplateExpression(node)) {
      // Only the head — the text before the first `${…}` — can start the string.
      record(node.head.text, node.getStart(sf));
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return hits;
}
