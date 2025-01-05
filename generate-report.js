#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {renderTemplate} from "./templates.js";
import {Slope} from "./analysis.js";
import {formatMeasurement, JsonReport} from "./report.js";
import {GnuPlotter} from "./gnuplotter.js";
import {ReportData} from "./models.js";
import {slugify} from "./utils.js";

function generateBenchmarkReport(benchmark, outputDirectory) {
    console.log('generating plots and report for', benchmark.title);
    let reportDir = path.join(outputDirectory, slugify(benchmark.groupId), slugify(benchmark.functionId), "report");
    fs.mkdirSync(reportDir, {recursive: true});

    let timeInterval = (est) => {
        let {lowerBound, pointEstimate, upperBound} = est.estimates;
        return {
            lowerBound: formatMeasurement(lowerBound),
            pointEstimate: formatMeasurement(pointEstimate),
            upperBound: formatMeasurement(upperBound),
        }
    };
    let r2Interval = (est) => {
        let {lowerBound, pointEstimate, upperBound} = est.estimates;
        let xs = benchmark.measurements.iters;
        let ys = benchmark.measurements.times;
        let format = x => Slope.rSquared(x, xs, ys).toFixed(7);
        return {
            lowerBound: format(lowerBound),
            pointEstimate: format(pointEstimate),
            upperBound: format(upperBound),
        };
    };

    GnuPlotter.pdfSmall(reportDir, benchmark.measurements.iters, benchmark.measurements.times);
    GnuPlotter.pdf(benchmark.title, reportDir, benchmark.measurements);

    GnuPlotter.regressionSmall(reportDir, benchmark.measurements, benchmark.statistics);
    GnuPlotter.regression(benchmark.title, reportDir, benchmark.measurements, benchmark.statistics);

    GnuPlotter.statistic(`${benchmark.title}: Mean`, path.join(reportDir, 'mean.svg'), benchmark.statistics.mean);
    GnuPlotter.statistic(`${benchmark.title}: Median`, path.join(reportDir, 'median.svg'), benchmark.statistics.median);
    GnuPlotter.statistic(`${benchmark.title}: Std. Dev.`, path.join(reportDir, 'stdDev.svg'), benchmark.statistics.stdDev);
    GnuPlotter.statistic(`${benchmark.title}: MAD`, path.join(reportDir, 'mad.svg'), benchmark.statistics.medianAbsDev);
    GnuPlotter.statistic(`${benchmark.title}: Slope`, path.join(reportDir, 'slope.svg'), benchmark.statistics.slope);

    let context = {
        title: benchmark.title,
        confidence: benchmark.statistics.slope.estimates.confidenceLevel.toFixed(2),

        additionalStatistics: [
            {name: "Mean", ...timeInterval(benchmark.statistics.mean)},
            {name: "Median", ...timeInterval(benchmark.statistics.median)},
            {name: "Std. Dev.", title: "Standard Deviation", ...timeInterval(benchmark.statistics.stdDev)},
            {name: "Slope", ...timeInterval(benchmark.statistics.slope),},
            {name: "MAD", title: "Mean Absolute Deviation", ...timeInterval(benchmark.statistics.medianAbsDev)},
            {name: "R²", title: "Coefficient of Determination", ...r2Interval(benchmark.statistics.slope)},
        ],
        additionalPlots: [
            {name: 'Mean', url: 'mean.svg'},
            {name: 'Median', url: 'median.svg'},
            {name: 'Std. Dev.', url: 'stdDev.svg'},
            {name: 'MAD', url: 'mad.svg'},
            {name: 'Slope', url: 'slope.svg'}
        ],
    };

    writeReport(reportDir, "benchmark", context)
}

function generateGroupReport(group, outputDirectory) {
    let reportDir = path.join(outputDirectory, slugify(group.name), 'report');
    fs.mkdirSync(reportDir, {recursive: true})

    GnuPlotter.violin(reportDir, group.benchmarks);

    let context = {
        name: group.name,
        benchmarks: group.benchmarks // name + path
    };

    writeReport(reportDir, 'group', context)
}

function listBenchmarks(directory) {
    const walkSync = (dir, callback) => {
        const files = fs.readdirSync(dir);
        files.forEach((file) => {
            let filepath = path.join(dir, file);
            const stats = fs.statSync(filepath);
            if (stats.isDirectory()) {
                walkSync(filepath, callback);
            } else if (stats.isFile() && file === "benchmark.json") {
                callback(filepath);
            }
        });
    };
    let benchmarks = [];
    walkSync(directory, (file) => {
        benchmarks.push(file);
    });
    return benchmarks;
}

function loadBenchmark(benchmarkFile) {
    let blob = fs.readFileSync(benchmarkFile);
    let pojo = JSON.parse(blob);
    let {version} = pojo;

    if (version === undefined || Number(version) < JsonReport.VERSION) {
        console.error('[WARN] benchmark data in old format, skipping:', benchmarkFile)
        return;
    } else if (version !== JsonReport.VERSION) {
        console.error(`[WARN] unknown file version '${version}' (current is '${JsonReport.VERSION}'), skipping:`, benchmarkFile);
        return;
    }

    try {
        return ReportData.parse(pojo);
    } catch (error) {
        console.error(`[WARN] couldn't create Benchmark instance, skipping: ${benchmarkFile} (${error.message})`);
        if (process.env.CRITERION_DEBUG) {
            console.error(error);
        }
    }
}

function loadBenchmarks(outputDir) {
    return listBenchmarks(outputDir)
        .map(loadBenchmark)
        .filter(benchmark => benchmark)
        .sort((a, b) => a.title.localeCompare(b.title));
}

function writeReport(reportDir, template, context) {
    fs.mkdirSync(reportDir, {recursive: true});
    let reportPath = path.join(reportDir, "index.html");
    let report = renderTemplate(template, context);
    fs.writeFileSync(reportPath, report);
}

function generateFinalReport(outputDir, groups) {
    let reportDir = path.join(outputDir, "report");
    writeReport(reportDir, "index", {groups});
    console.log(`Wrote: ${reportDir}/index.html`);
}

function getOutputDirOrDie() {
    // TODO: add some marker file to confirm that this is a criterion dir?
    let maybeCriterionDir = process.argv[2];
    if (process.argv.length !== 3 || !fs.existsSync(maybeCriterionDir)) {
        console.error("usage: npx criterion-report path_to_criterion_folder");
        process.exit(1);
    }
    return maybeCriterionDir;
}

function toPresentationGroup(group, outputDir) {
    let groupId = group[0].groupId;

    let functionAverages = {};
    for (let benchmark of group) {
        functionAverages[benchmark.functionId] = benchmark.measurements.averages;
    }

    let benchmarks = Object.keys(functionAverages)
        .sort()
        .map((f) => ({
            name: f,
            path: path.join(outputDir, slugify(groupId), slugify(f)),
            averages: functionAverages[f]
        }));

    return {
        name: groupId,
        path: path.join(outputDir, slugify(groupId), "report", "index.html"),
        benchmarks,
    };
}

function createPresentationGroups(benchmarks, outputDir) {
    let benchmarksByGroupId = {};
    for (let benchmark of benchmarks) {
        (benchmarksByGroupId[benchmark.groupId] ??= []).push(benchmark)
    }

    return Object.values(benchmarksByGroupId)
        .map(group => toPresentationGroup(group, outputDir))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
    let outputDir = getOutputDirOrDie();

    let benchmarks = loadBenchmarks(outputDir);
    for (let benchmark of benchmarks) {
        generateBenchmarkReport(benchmark, outputDir);
    }

    let groups = createPresentationGroups(benchmarks, outputDir);
    for (let group of groups) {
        generateGroupReport(group, outputDir);
    }

    generateFinalReport(outputDir, groups);
}

main();
