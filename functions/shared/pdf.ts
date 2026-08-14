export function pdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
