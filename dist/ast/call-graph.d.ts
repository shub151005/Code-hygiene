import type { File as BabelFile } from '@babel/types';
export interface SymbolDeclaration {
    name: string;
    kind: 'function' | 'variable' | 'class' | 'export-default';
    isExported: boolean;
    line: number;
    column: number;
}
export interface FileImport {
    rawSource: string;
    resolvedPath?: string;
    isPackage: boolean;
    packageName?: string;
    importedSymbols: string[];
}
export interface FileAnalysis {
    filePath: string;
    imports: FileImport[];
    declarations: Map<string, SymbolDeclaration>;
    internalReferences: Map<string, number>;
    exportedSymbols: Set<string>;
}
export declare function analyzeFileAST(filePath: string, ast: BabelFile, projectRoot: string): FileAnalysis;
