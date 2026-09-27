#!/usr/bin/env node
import type { AuditOptions, AuditReport } from './types.js';
export declare function runAudit(options: AuditOptions): Promise<AuditReport>;
