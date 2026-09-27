export function add(a: number, b: number): number {
  return a + b;
}

// Dead export: exported but never imported anywhere in the project
export function unusedCalculator(x: number, y: number, op: string): number {
  if (op === 'multiply') return x * y;
  if (op === 'divide') return x / y;
  return x + y;
}
