import fs from 'node:fs';
import path from 'node:path';
import {HtmlBenchmarkGroup, InternalBenchmarkId} from "./index.mjs";
import {renderTemplate} from "./templates.mjs";

function listBenchmarks(directory) {
    const walkSync = (dir, callback) => {
        const files = fs.readdirSync(dir);
        files.forEach((file) => {
            let filepath = path.join(dir, file);
            const stats = fs.statSync(filepath);
            if (stats.isDirectory()) {
                walkSync(filepath, callback);
            } else if (stats.isFile() && file === 'benchmark.json') {
                callback(filepath);
            }
        });
    };
    let benchmarks = [];
    walkSync(directory, file => {
        let blob = fs.readFileSync(file);
        let {groupId, functionId, valueString, throughput} = JSON.parse(blob);
        let id = new InternalBenchmarkId(groupId, functionId, valueString, throughput);
        return benchmarks.push(id);
    })
    return benchmarks;
}


async function main() {
    if (process.argv.length !== 3 || !fs.existsSync(process.argv[2])) {
        console.error('usage: generate-report path_to_criterion_folder')
        process.exit(1)
    }
    let outputDir = process.argv[2];
    let benchmarks = listBenchmarks(outputDir);
    console.log(`Found ${benchmarks.length} benchmark reports.`)
    benchmarks.sort((a, b) => a.fullId.localeCompare(b.fullId));
    let idGroups = {};
    for (let benchmark of benchmarks) {
        let group = idGroups[benchmark.groupId] || [];
        group.push(benchmark);
        idGroups[benchmark.groupId] = group;
    }

    let groups = Object.values(idGroups).map(group => HtmlBenchmarkGroup.fromGroup(outputDir, group));
    groups.sort((a, b) => a.groupReport.name.localeCompare(b.groupReport.name));

    let reportDir = path.join(outputDir, 'report');
    fs.mkdirSync(reportDir, {recursive: true});
    let reportPath = path.join(reportDir, 'index.html')

    fs.writeFileSync(reportPath, renderTemplate('index', {groups, title: 'my report', content: 'wat?'}));

    console.log('Wrote', reportPath);
}

main()
