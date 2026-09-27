/**
 * Aggregates all package imports across analyzed source files.
 */
export function buildPackageImportMap(fileAnalyses) {
    const map = {};
    for (const [filePath, analysis] of fileAnalyses.entries()) {
        for (const imp of analysis.imports) {
            if (imp.isPackage && imp.packageName) {
                if (!map[imp.packageName]) {
                    map[imp.packageName] = new Set();
                }
                map[imp.packageName].add(filePath);
            }
        }
    }
    return map;
}
/**
 * Checks dependencies against package imports to identify unused packages.
 */
export function checkUnusedDependencies(dependencies, packageImportMap) {
    const unusedDependencies = [];
    const packageUsage = new Map();
    for (const dep of dependencies) {
        const importingFiles = packageImportMap[dep.name] || new Set();
        const isUsed = importingFiles.size > 0;
        packageUsage.set(dep.name, {
            isUsed,
            importedInFiles: Array.from(importingFiles),
        });
        // Only flag runtime dependencies as unused (devDependencies often run outside code)
        if (!dep.isDevDependency && !isUsed) {
            unusedDependencies.push(dep);
        }
    }
    return {
        unusedDependencies,
        packageUsage,
    };
}
