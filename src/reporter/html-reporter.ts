import fs from 'node:fs';
import path from 'node:path';
import type { AuditReport } from '../types.js';

export function generateHtmlReport(report: AuditReport, outputPath?: string): string {
  const { metrics, deadCode, dependencies, targetDirectory, timestamp } = report;

  const scoreColor =
    metrics.healthScore >= 80 ? '#10b981' : metrics.healthScore >= 50 ? '#f59e0b' : '#ef4444';

  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (metrics.healthScore / 100) * circumference;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Hygiene & Security Audit Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --danger: #ef4444;
      --warning: #f59e0b;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text-main); padding: 2rem; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--card-border); }
    h1 { font-size: 1.875rem; font-weight: 700; color: #fff; }
    .meta { font-size: 0.875rem; color: var(--text-muted); margin-top: 0.25rem; }
    
    /* Metrics Row */
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
    .metric-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 0.75rem; padding: 1.25rem; display: flex; align-items: center; gap: 1rem; }
    .metric-val { font-size: 1.75rem; font-weight: 700; }
    .metric-label { font-size: 0.8125rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

    /* Health Gauge */
    .gauge-wrapper { position: relative; width: 100px; height: 100px; }
    .gauge-wrapper svg { transform: rotate(-90deg); width: 100%; height: 100%; }
    .gauge-bg { stroke: #334155; fill: none; stroke-width: 10; }
    .gauge-progress { stroke: ${scoreColor}; fill: none; stroke-width: 10; stroke-linecap: round; stroke-dasharray: ${circumference}; stroke-dashoffset: ${strokeDashoffset}; transition: stroke-dashoffset 0.8s ease; }
    .gauge-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; font-weight: 700; }

    /* Filters & Search */
    .controls { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; justify-content: space-between; align-items: center; }
    .filter-tabs { display: flex; gap: 0.5rem; }
    .tab-btn { background: #1e293b; color: var(--text-muted); border: 1px solid var(--card-border); padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.875rem; transition: all 0.2s; }
    .tab-btn.active, .tab-btn:hover { background: var(--primary); color: #fff; border-color: var(--primary); }
    .search-box { background: var(--card-bg); border: 1px solid var(--card-border); color: #fff; padding: 0.5rem 1rem; border-radius: 0.5rem; width: 280px; }

    /* Findings List */
    .findings-container { display: flex; flex-direction: column; gap: 1rem; }
    .finding-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 0.75rem; padding: 1.25rem; transition: border-color 0.2s; }
    .finding-card:hover { border-color: #64748b; }
    .finding-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .badge { padding: 0.2rem 0.6rem; border-radius: 0.375rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .badge-danger { background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); }
    .badge-warning { background: rgba(245, 158, 11, 0.2); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.4); }
    .badge-blue { background: rgba(59, 130, 246, 0.2); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.4); }
    .finding-title { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.25rem; }
    .finding-meta { font-size: 0.8125rem; color: var(--text-muted); font-family: monospace; }
    .snippet { background: #0b0f19; border: 1px solid #1e293b; padding: 0.75rem; border-radius: 0.5rem; font-family: monospace; font-size: 0.875rem; margin: 0.75rem 0; overflow-x: auto; color: #38bdf8; }
    .suggestion { font-size: 0.875rem; color: #cbd5e1; display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Code Hygiene & Security Dashboard</h1>
        <div class="meta">Directory: <strong>${path.resolve(targetDirectory)}</strong> • Generated: ${new Date(timestamp).toLocaleString()}</div>
      </div>
      <div class="gauge-wrapper">
        <svg viewBox="0 0 100 100">
          <circle class="gauge-bg" cx="50" cy="50" r="45"></circle>
          <circle class="gauge-progress" cx="50" cy="50" r="45"></circle>
        </svg>
        <div class="gauge-text" style="color: ${scoreColor}">${metrics.healthScore}</div>
      </div>
    </header>

    <div class="metrics-grid">
      <div class="metric-card">
        <div>
          <div class="metric-val" style="color: #38bdf8">${metrics.totalFilesScanned}</div>
          <div class="metric-label">Files Scanned</div>
        </div>
      </div>
      <div class="metric-card">
        <div>
          <div class="metric-val" style="color: ${metrics.deadCodeCount > 0 ? '#ef4444' : '#10b981'}">${metrics.deadCodeCount}</div>
          <div class="metric-label">Dead Code Items</div>
        </div>
      </div>
      <div class="metric-card">
        <div>
          <div class="metric-val" style="color: ${metrics.unusedDependenciesCount > 0 ? '#f59e0b' : '#10b981'}">${metrics.unusedDependenciesCount}</div>
          <div class="metric-label">Unused Packages</div>
        </div>
      </div>
      <div class="metric-card">
        <div>
          <div class="metric-val" style="color: ${metrics.vulnerableDependenciesCount > 0 ? '#ef4444' : '#10b981'}">${metrics.vulnerableDependenciesCount}</div>
          <div class="metric-label">Vulnerabilities (${metrics.reachableVulnerabilitiesCount} Reachable)</div>
        </div>
      </div>
    </div>

    <div class="controls">
      <div class="filter-tabs">
        <button class="tab-btn active" onclick="filterFindings('all')">All Findings</button>
        <button class="tab-btn" onclick="filterFindings('dead-code')">Dead Code (${deadCode.length})</button>
        <button class="tab-btn" onclick="filterFindings('vulnerabilities')">Vulnerabilities (${dependencies.filter(d => d.status === 'vulnerable').length})</button>
        <button class="tab-btn" onclick="filterFindings('unused-deps')">Unused Packages (${dependencies.filter(d => d.status === 'unused').length})</button>
      </div>
      <input type="text" id="searchInput" class="search-box" placeholder="Search findings..." onkeyup="searchFindings()">
    </div>

    <div class="findings-container" id="findingsList">
      ${deadCode.map(item => `
        <div class="finding-card" data-category="dead-code" data-name="${item.name.toLowerCase()}">
          <div class="finding-header">
            <span class="badge ${item.type === 'orphan-file' ? 'badge-danger' : 'badge-warning'}">${item.type}</span>
            <span class="finding-meta">${item.filePath}:${item.line}</span>
          </div>
          <div class="finding-title">${item.name}</div>
          ${item.preview ? `<div class="snippet">${escapeHtml(item.preview)}</div>` : ''}
          <div class="suggestion">💡 ${escapeHtml(item.suggestion)}</div>
        </div>
      `).join('')}

      ${dependencies.filter(d => d.status !== 'clean').map(dep => `
        <div class="finding-card" data-category="${dep.status === 'vulnerable' ? 'vulnerabilities' : 'unused-deps'}" data-name="${dep.packageName.toLowerCase()}">
          <div class="finding-header">
            <span class="badge ${dep.status === 'vulnerable' ? 'badge-danger' : 'badge-warning'}">
              ${dep.status === 'vulnerable' ? (dep.isReachable ? 'REACHABLE VULNERABILITY' : 'ISOLATED VULNERABILITY') : 'UNUSED PACKAGE'}
            </span>
            <span class="finding-meta">Version: ${dep.declaredVersion}</span>
          </div>
          <div class="finding-title">${dep.packageName}</div>
          ${dep.vulnerabilities.map(v => `
            <div class="snippet" style="color: #f87171">
              <strong>${v.id}</strong> [${v.severity}] - ${escapeHtml(v.summary)}
              ${v.fixedVersion ? `<br><span style="color: #34d399">Fixed in: >= ${v.fixedVersion}</span>` : ''}
            </div>
          `).join('')}
          <div class="suggestion">💡 ${escapeHtml(dep.upgradeSuggestion || '')}</div>
        </div>
      `).join('')}
    </div>
  </div>

  <script>
    function filterFindings(category) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');

      const cards = document.querySelectorAll('.finding-card');
      cards.forEach(card => {
        if (category === 'all' || card.dataset.category === category) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }

    function searchFindings() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const cards = document.querySelectorAll('.finding-card');
      cards.forEach(card => {
        const name = card.dataset.name || '';
        const text = card.innerText.toLowerCase();
        if (name.includes(q) || text.includes(q)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;

  if (outputPath) {
    fs.writeFileSync(outputPath, html, 'utf-8');
  }

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
