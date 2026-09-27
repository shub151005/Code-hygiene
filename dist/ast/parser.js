import fs from 'node:fs';
import { parse } from '@babel/parser';
const BABEL_PLUGINS = [
    'typescript',
    'jsx',
    'decorators-legacy',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'exportDefaultFrom',
    'topLevelAwait',
];
export function parseSourceFile(filePath) {
    let sourceCode = '';
    try {
        sourceCode = fs.readFileSync(filePath, 'utf-8');
    }
    catch (err) {
        return {
            filePath,
            sourceCode: '',
            ast: null,
            error: `Could not read file: ${err.message}`,
        };
    }
    try {
        const ast = parse(sourceCode, {
            sourceType: 'module',
            plugins: BABEL_PLUGINS,
            allowImportExportEverywhere: true,
            allowReturnOutsideFunction: true,
            errorRecovery: true,
        });
        return {
            filePath,
            sourceCode,
            ast,
        };
    }
    catch (err) {
        return {
            filePath,
            sourceCode,
            ast: null,
            error: `Failed to parse AST: ${err.message}`,
        };
    }
}
