import * as ts from 'typescript';

const ROUTE_SEGMENT =
  /^\/(?:app|login|signup|forgot-password|reset-password)(?![\w-])/;

export interface RouteLiteralHit {
  line: number;
  column: number;
  text: string;
}

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
     true,
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
      record(node.head.text, node.getStart(sf));
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return hits;
}
