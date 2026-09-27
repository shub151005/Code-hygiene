import fs from 'node:fs';
import path from 'node:path';

export interface ParsedDependency {
  name: string;
  declaredVersion: string;
  resolvedVersion?: string;
  isDevDependency: boolean;
}

export interface ProjectManifest {
  name: string;
  version: string;
  dependencies: ParsedDependency[];
}

export function parseProjectManifest(projectRoot: string): ProjectManifest | null {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);

    // Try reading package-lock.json for resolved versions
    let resolvedVersions: Record<string, string> = {};
    const lockPath = path.join(projectRoot, 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        if (lock.packages) {
          for (const [key, val] of Object.entries<any>(lock.packages)) {
            const cleanName = key.replace(/^node_modules\//, '');
            if (val.version) {
              resolvedVersions[cleanName] = val.version;
            }
          }
        } else if (lock.dependencies) {
          for (const [key, val] of Object.entries<any>(lock.dependencies)) {
            if (val.version) {
              resolvedVersions[key] = val.version;
            }
          }
        }
      } catch {
        // Ignore lockfile parse issues
      }
    }

    const dependencies: ParsedDependency[] = [];

    if (pkg.dependencies) {
      for (const [name, declaredVersion] of Object.entries<string>(pkg.dependencies)) {
        dependencies.push({
          name,
          declaredVersion,
          resolvedVersion: resolvedVersions[name] || cleanVersion(declaredVersion),
          isDevDependency: false,
        });
      }
    }

    if (pkg.devDependencies) {
      for (const [name, declaredVersion] of Object.entries<string>(pkg.devDependencies)) {
        dependencies.push({
          name,
          declaredVersion,
          resolvedVersion: resolvedVersions[name] || cleanVersion(declaredVersion),
          isDevDependency: true,
        });
      }
    }

    return {
      name: pkg.name || 'unnamed-project',
      version: pkg.version || '1.0.0',
      dependencies,
    };
  } catch (err) {
    return null;
  }
}

function cleanVersion(version: string): string {
  // Strip ^, ~, >=, v prefixes: e.g. "^4.17.21" -> "4.17.21"
  return version.replace(/^[\^~>=<v]+/, '').trim();
}
