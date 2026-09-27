const OSV_API_URL = 'https://api.osv.dev/v1/query';
/**
 * Queries Google OSV API for a single package version.
 */
export async function queryOSV(packageName, version) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const cleanVer = version.replace(/^[\^~>=<v]+/, '').trim();
        const response = await fetch(OSV_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                version: cleanVer,
                package: {
                    name: packageName,
                    ecosystem: 'npm',
                },
            }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) {
            return [];
        }
        const data = await response.json();
        if (!data || !Array.isArray(data.vulns)) {
            return [];
        }
        const vulnerabilities = [];
        for (const vuln of data.vulns) {
            let fixedVersion;
            if (Array.isArray(vuln.affected)) {
                for (const aff of vuln.affected) {
                    if (Array.isArray(aff.ranges)) {
                        for (const range of aff.ranges) {
                            if (Array.isArray(range.events)) {
                                for (const ev of range.events) {
                                    if (ev.fixed) {
                                        fixedVersion = ev.fixed;
                                        break;
                                    }
                                }
                            }
                            if (fixedVersion)
                                break;
                        }
                    }
                    if (fixedVersion)
                        break;
                }
            }
            let severity = 'MODERATE';
            const rawSeverity = vuln.database_specific?.severity ||
                (Array.isArray(vuln.severity) && vuln.severity[0]?.score) ||
                '';
            const s = String(rawSeverity).toUpperCase();
            if (s.includes('CRITICAL'))
                severity = 'CRITICAL';
            else if (s.includes('HIGH'))
                severity = 'HIGH';
            else if (s.includes('LOW'))
                severity = 'LOW';
            else
                severity = 'MODERATE';
            vulnerabilities.push({
                id: vuln.id,
                summary: vuln.summary || (vuln.details ? vuln.details.slice(0, 100) + '...' : 'Known vulnerability'),
                details: vuln.details,
                severity,
                fixedVersion,
                referenceUrl: Array.isArray(vuln.references) && vuln.references[0]?.url ? vuln.references[0].url : undefined,
            });
        }
        return vulnerabilities;
    }
    catch (err) {
        return [];
    }
}
/**
 * Audits all project dependencies concurrently against OSV and computes reachability.
 */
export async function auditDependencies(dependencies, packageUsage, skipNetwork = false) {
    const auditPromises = dependencies.map(async (dep) => {
        const usage = packageUsage.get(dep.name) || { isUsed: false, importedInFiles: [] };
        const versionToCheck = dep.resolvedVersion || dep.declaredVersion;
        let vulns = [];
        if (!skipNetwork && versionToCheck) {
            vulns = await queryOSV(dep.name, versionToCheck);
        }
        let status = 'clean';
        let upgradeSuggestion;
        if (vulns.length > 0) {
            status = 'vulnerable';
            const fixes = vulns.map((v) => v.fixedVersion).filter(Boolean);
            if (fixes.length > 0) {
                upgradeSuggestion = `Upgrade to >= ${fixes[0]}`;
            }
            else {
                upgradeSuggestion = 'Update to latest patch release or check security advisories';
            }
        }
        else if (!dep.isDevDependency && !usage.isUsed) {
            status = 'unused';
            upgradeSuggestion = 'Remove package (never imported in source code)';
        }
        return {
            packageName: dep.name,
            declaredVersion: dep.declaredVersion,
            resolvedVersion: dep.resolvedVersion,
            isDevDependency: dep.isDevDependency,
            status,
            isReachable: usage.isUsed,
            importedInFiles: usage.importedInFiles,
            vulnerabilities: vulns,
            upgradeSuggestion,
        };
    });
    return Promise.all(auditPromises);
}
