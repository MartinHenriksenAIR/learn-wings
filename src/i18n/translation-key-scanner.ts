import * as ts from 'typescript';

export interface TranslationKeyHit {
  key: string;
  line: number;
  column: number;
}

function isTranslationCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 't';
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 't';
  return false;
}

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
     true,
    scriptKind,
  );
  const hits: TranslationKeyHit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTranslationCall(node)) {
      const [first] = node.arguments;
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
