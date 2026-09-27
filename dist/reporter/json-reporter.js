import fs from 'node:fs';
export function generateJsonReport(report, outputPath) {
    const json = JSON.stringify(report, null, 2);
    if (outputPath) {
        fs.writeFileSync(outputPath, json, 'utf-8');
    }
    return json;
}
