import fs from 'node:fs';
import { parse, ParserPlugin } from '@babel/parser';
import type { File as BabelFile } from '@babel/types';

const BABEL_PLUGINS: ParserPlugin[] = [
  'typescript',
  'jsx',
  'decorators-legacy',
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'exportDefaultFrom',
  'topLevelAwait',
];

export interface ParsedSourceFile {
  filePath: string;
  sourceCode: string;
  ast: BabelFile | null;
  error?: string;
}

export function parseSourceFile(filePath: string): ParsedSourceFile {
  let sourceCode = '';
  try {
    sourceCode = fs.readFileSync(filePath, 'utf-8');
  } catch (err: any) {
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
  } catch (err: any) {
    return {
      filePath,
      sourceCode,
      ast: null,
      error: `Failed to parse AST: ${err.message}`,
    };
  }
}
