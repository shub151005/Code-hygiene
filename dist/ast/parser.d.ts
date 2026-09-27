import type { File as BabelFile } from '@babel/types';
export interface ParsedSourceFile {
    filePath: string;
    sourceCode: string;
    ast: BabelFile | null;
    error?: string;
}
export declare function parseSourceFile(filePath: string): ParsedSourceFile;
