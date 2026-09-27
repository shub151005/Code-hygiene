import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import path from 'node:path';
// Handle ESM / CJS interop for @babel/traverse
const traverse = _traverse.default || _traverse;
export function analyzeFileAST(filePath, ast, projectRoot) {
    const imports = [];
    const declarations = new Map();
    const internalReferences = new Map();
    const exportedSymbols = new Set();
    const recordRef = (name) => {
        internalReferences.set(name, (internalReferences.get(name) || 0) + 1);
    };
    traverse(ast, {
        // 1. Process Import Declarations
        ImportDeclaration(nodePath) {
            const source = nodePath.node.source.value;
            const importedSymbols = [];
            for (const specifier of nodePath.node.specifiers) {
                if (t.isImportDefaultSpecifier(specifier)) {
                    importedSymbols.push('default');
                }
                else if (t.isImportSpecifier(specifier)) {
                    const importedName = t.isIdentifier(specifier.imported)
                        ? specifier.imported.name
                        : specifier.imported.value;
                    importedSymbols.push(importedName);
                }
                else if (t.isImportNamespaceSpecifier(specifier)) {
                    importedSymbols.push('*');
                }
            }
            const isPackage = !source.startsWith('.') && !source.startsWith('/') && !path.isAbsolute(source);
            let packageName;
            if (isPackage) {
                if (source.startsWith('@')) {
                    const parts = source.split('/');
                    packageName = parts.slice(0, 2).join('/');
                }
                else {
                    packageName = source.split('/')[0];
                }
            }
            imports.push({
                rawSource: source,
                isPackage,
                packageName,
                importedSymbols,
            });
        },
        // 2. Process require() / dynamic import() calls
        CallExpression(nodePath) {
            const callee = nodePath.node.callee;
            if (t.isIdentifier(callee, { name: 'require' }) && nodePath.node.arguments.length > 0) {
                const arg = nodePath.node.arguments[0];
                if (t.isStringLiteral(arg)) {
                    const source = arg.value;
                    const isPackage = !source.startsWith('.') && !source.startsWith('/') && !path.isAbsolute(source);
                    let packageName;
                    if (isPackage) {
                        packageName = source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0];
                    }
                    imports.push({
                        rawSource: source,
                        isPackage,
                        packageName,
                        importedSymbols: ['*'],
                    });
                }
            }
        },
        // 3. Process Declarations (Functions, Classes, Variables)
        FunctionDeclaration(nodePath) {
            if (nodePath.node.id) {
                const name = nodePath.node.id.name;
                const line = nodePath.node.loc?.start.line || 1;
                const column = nodePath.node.loc?.start.column || 0;
                const isExported = t.isExportNamedDeclaration(nodePath.parent) || t.isExportDefaultDeclaration(nodePath.parent);
                declarations.set(name, {
                    name,
                    kind: 'function',
                    isExported,
                    line,
                    column,
                });
                if (isExported) {
                    exportedSymbols.add(t.isExportDefaultDeclaration(nodePath.parent) ? 'default' : name);
                }
            }
        },
        VariableDeclarator(nodePath) {
            if (t.isIdentifier(nodePath.node.id)) {
                const name = nodePath.node.id.name;
                const line = nodePath.node.loc?.start.line || 1;
                const column = nodePath.node.loc?.start.column || 0;
                const parentExport = nodePath.findParent((p) => p.isExportNamedDeclaration());
                const isExported = !!parentExport;
                const isFunc = t.isArrowFunctionExpression(nodePath.node.init) ||
                    t.isFunctionExpression(nodePath.node.init);
                declarations.set(name, {
                    name,
                    kind: isFunc ? 'function' : 'variable',
                    isExported,
                    line,
                    column,
                });
                if (isExported) {
                    exportedSymbols.add(name);
                }
            }
        },
        ClassDeclaration(nodePath) {
            if (nodePath.node.id) {
                const name = nodePath.node.id.name;
                const line = nodePath.node.loc?.start.line || 1;
                const column = nodePath.node.loc?.start.column || 0;
                const isExported = t.isExportNamedDeclaration(nodePath.parent) || t.isExportDefaultDeclaration(nodePath.parent);
                declarations.set(name, {
                    name,
                    kind: 'class',
                    isExported,
                    line,
                    column,
                });
                if (isExported) {
                    exportedSymbols.add(t.isExportDefaultDeclaration(nodePath.parent) ? 'default' : name);
                }
            }
        },
        ExportNamedDeclaration(nodePath) {
            if (nodePath.node.specifiers) {
                for (const specifier of nodePath.node.specifiers) {
                    if (t.isExportSpecifier(specifier)) {
                        const exportedName = t.isIdentifier(specifier.exported)
                            ? specifier.exported.name
                            : specifier.exported.value;
                        exportedSymbols.add(exportedName);
                    }
                }
            }
        },
        ExportDefaultDeclaration(nodePath) {
            if (t.isIdentifier(nodePath.node.declaration)) {
                exportedSymbols.add('default');
                recordRef(nodePath.node.declaration.name);
            }
        },
        // 4. Track Identifier references (excluding declaration identifiers themselves)
        Identifier(nodePath) {
            const name = nodePath.node.name;
            if ((t.isFunctionDeclaration(nodePath.parent) && nodePath.parent.id === nodePath.node) ||
                (t.isVariableDeclarator(nodePath.parent) && nodePath.parent.id === nodePath.node) ||
                (t.isClassDeclaration(nodePath.parent) && nodePath.parent.id === nodePath.node) ||
                (t.isImportSpecifier(nodePath.parent) && nodePath.parent.local === nodePath.node) ||
                (t.isImportDefaultSpecifier(nodePath.parent) && nodePath.parent.local === nodePath.node) ||
                (t.isImportNamespaceSpecifier(nodePath.parent) && nodePath.parent.local === nodePath.node) ||
                (t.isObjectProperty(nodePath.parent) && nodePath.parent.key === nodePath.node && !nodePath.parent.computed) ||
                (t.isMemberExpression(nodePath.parent) && nodePath.parent.property === nodePath.node && !nodePath.parent.computed)) {
                return;
            }
            recordRef(name);
        },
        JSXIdentifier(nodePath) {
            recordRef(nodePath.node.name);
        },
    });
    return {
        filePath,
        imports,
        declarations,
        internalReferences,
        exportedSymbols,
    };
}
