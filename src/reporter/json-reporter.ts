import fs from 'node:fs';
import type { AuditReport } from '../types.js';

export function generateJsonReport(report: AuditReport, outputPath?: string): string {
  const json = JSON.stringify(report, null, 2);

  if (outputPath) {
    fs.writeFileSync(outputPath, json, 'utf-8');
  }

  return json;
}
