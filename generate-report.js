#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {BenchmarkId, slugify} from "./index.js";
import {renderTemplate} from "./templates.js";
import {Slope} from "./analysis.js";
import {formatMeasurement, JsonReport} from "./report.js";
import {GnuPlotter} from "./gnuplotter.js";

function generatePlotsAndReport(benchmark, outputDir) {
    let {id, measurements, statistics} = benchmark;
    let title = benchmark.id.title;
    let outputDirectory = path.join(outputDir, id.directoryName)

    console.log('generating plots and report for', title);
    let reportDir = path.join(outputDirectory, "report");
    fs.mkdirSync(reportDir, {recursive: true});

    let timeInterval = (est) => {
        return {
            lower: formatMeasurement(est.lb),
            point: formatMeasurement(est.point),
            upper: formatMeasurement(est.ub),
        }
    };
    let r2Interval = (est) => {
        let format = x => Slope.rSquared(x, data).toFixed(7);
        return {
            lower: format(est.lb),
            point: format(est.point),
            upper: format(est.ub),
        };
    };

    let data = {xs: measurements.iters, ys: measurements.times};

    GnuPlotter.pdfSmall(reportDir, measurements.averages);
    GnuPlotter.pdf(title, reportDir, measurements);

    GnuPlotter.regressionSmall(reportDir, measurements, statistics);
    GnuPlotter.regression(title, reportDir, measurements, statistics);

    GnuPlotter.statistic(title, reportDir, 'Mean', 'mean.svg', statistics.mean.bootstrap, statistics.mean.estimates);
    GnuPlotter.statistic(title, reportDir, 'Median', 'median.svg', statistics.median.bootstrap, statistics.median.estimates);
    GnuPlotter.statistic(title, reportDir, 'Std. Dev.', 'stdDev.svg', statistics.stdDev.bootstrap, statistics.stdDev.estimates);
    GnuPlotter.statistic(title, reportDir, 'MAD', 'mad.svg', statistics.medianAbsDev.bootstrap, statistics.medianAbsDev.estimates);
    GnuPlotter.statistic(title, reportDir, 'Slope', 'slope.svg', statistics.slope.bootstrap, statistics.slope.estimates);

    let context = {
        title: title,
        confidence: statistics.slope.estimates.cl.toFixed(2),

        additionalStatistics: [
            {name: "Mean", ...timeInterval(statistics.mean.estimates)},
            {name: "Median", ...timeInterval(statistics.median.estimates)},
            {name: "Std. Dev.", ...timeInterval(statistics.stdDev.estimates)},
            {name: "Slope", ...timeInterval(statistics.slope.estimates)},
            {name: "MAD", ...timeInterval(statistics.medianAbsDev.estimates)},
            {name: "R²", ...r2Interval(statistics.slope.estimates)},
        ],
        additionalPlots: [
            {name: 'Mean', url: 'mean.svg'},
            {name: 'Median', url: 'median.svg'},
            {name: 'Std. Dev.', url: 'stdDev.svg'},
            {name: 'MAD', url: 'mad.svg'},
            {name: 'Slope', url: 'slope.svg'}
        ],
        comparison: null,
    };

    let report_path = path.join(reportDir, "index.html");
    let output = renderTemplate("benchmark_report", context);
    fs.writeFileSync(report_path, output);
}

/**
 * @typedef {Object} Benchmark
 * @property {string} name
 * @property {string} path
 */

/**
 * @typedef {Object} Group
 * @property {string} name
 * @property {string} path
 * @property {Benchmark[]} benchmarks
 * @property {string[]} funcs
 * @property {number[][]} allCurves
 */

/**
 * Generates report for the given group.
 * @param {Group} group - The group object.
 * @param {string} outputDirectory - Where to write the report
 */
function generateGroupReport(group, outputDirectory) {
    let reportDir = path.join(outputDirectory, slugify(group.name), 'report');
    fs.mkdirSync(reportDir, {recursive: true})

    GnuPlotter.violin(reportDir, group.benchmarks);

    let context = {
        name: group.name,
        benchmarks: group.benchmarks // name + path
    };

    let report_path = path.join(reportDir, 'index.html');
    let report = renderTemplate('summary_report', context);
    fs.writeFileSync(report_path, report)
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

function isNumericArray(xs, l) {
    let expectedLength = l ?? xs.length;
    return Array.isArray(xs) && xs.length === expectedLength && xs.every(Number.isFinite);
}

function isStatisticsObject(statistic) {
    let estimates = ['cl', 'lb', 'ub', 'se', 'point'];
    return isNumericArray(statistic.bootstrap) && estimates.map(e => statistic.estimates[e]).every(Number.isFinite);
}

function loadBenchmark(benchmarkFile) {
    let blob = fs.readFileSync(benchmarkFile);
    let {version, groupId, functionId, measurements, statistics} = JSON.parse(blob);

    if (version === undefined || Number(version) < JsonReport.VERSION) {
        console.error('[WARN] benchmark data in old format, skipping:', benchmarkFile)
        return;
    } else if (version !== JsonReport.VERSION) {
        console.error(`[WARN] unknown file version '${version}' (current is '${JsonReport.VERSION}'), skipping:`, benchmarkFile);
        return;
    }

    try {
        return new Benchmark(groupId, functionId, measurements, statistics);
    } catch (error) {
        console.error(`[WARN] couldn't create Benchmark instance, skipping:`, benchmarkFile, error);
    }
}

class Benchmark {
    constructor(groupId, functionId, measurements, statistics) {
        this.id = new BenchmarkId(groupId, functionId)

        let {iters, times, averages, tukey} = measurements;
        if (!isNumericArray(iters)) {
            throw new Error('expected `measurements.iters` to be a numeric array');
        }
        if (!isNumericArray(times, iters.length)) {
            throw new Error('expected `measurements.times` to be a numeric array');
        }
        if (!isNumericArray(averages, iters.length)) {
            throw new Error('expected `measurements.averages` to be a numeric array');
        }
        if (!isNumericArray(tukey, 4)) {
            throw new Error('expected `measurements.tukey` to be a numeric array');
        }

        let entries = Object.entries(statistics);
        let knownStatistics = ['mean', 'median', 'medianAbsDev', 'slope', 'stdDev'];
        if (entries.length !== 5 || !knownStatistics.every(k => knownStatistics.includes(k))) {
            throw new Error('unexpected \`statistics\`')
        }
        for (let [k, v] of entries) {
            if (!knownStatistics.includes(k) || !isStatisticsObject(v)) {
                throw new Error(`unexpected \`statistics.${k}\``)
            }
        }

        this.measurements = measurements;
        this.statistics = statistics;
    }
}

function loadBenchmarks(outputDir) {
    return listBenchmarks(outputDir)
        .map(loadBenchmark)
        .filter(x => x)
        .sort((a, b) => `${a.groupId}/${a.functionId}`.localeCompare(`${b.groupId}/${b.functionId}`));
}

/**
 * @typedef {Object} Benchmark
 * @property {string} name
 * @property {string} path
 */

/**
 * @typedef {Object} IndexGroup
 * @property {string} name
 * @property {string} path
 * @property {Benchmark[]} benchmarks
 */

/**
 * @param {string} outputDir
 * @param {IndexGroup[]} groups
 */
function writeFinalReport(outputDir, groups) {
    let reportDir = path.join(outputDir, "report");
    fs.mkdirSync(reportDir, {recursive: true});

    let reportPath = path.join(reportDir, "index.html");
    let report = renderTemplate("index", {groups});

    fs.writeFileSync(reportPath, report);

    console.log("Wrote", reportPath);
}

function outputDirOrDie() {
    // TODO: add some marker file to confirm that this is a criterion dir?
    if (process.argv.length !== 3 || !fs.existsSync(process.argv[2])) {
        console.error("usage: npx criterion-report path_to_criterion_folder");
        process.exit(1);
    }
    return process.argv[2];
}

function toPresentationGroup(group, outputDir) {
    let groupId = group[0].id.groupId;

    let functionAverages = {};
    for (let benchmark of group) {
        functionAverages[benchmark.id.functionId] = benchmark.measurements.averages;
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
        (benchmarksByGroupId[benchmark.id.groupId] ??= []).push(benchmark)
    }

    return Object.values(benchmarksByGroupId)
        .map(group => toPresentationGroup(group, outputDir))
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
    let outputDir = outputDirOrDie();

    let benchmarks = loadBenchmarks(outputDir);
    for (let benchmark of benchmarks) {
        generatePlotsAndReport(benchmark, outputDir);
    }

    let groups = createPresentationGroups(benchmarks, outputDir);
    for (let group of groups) {
        generateGroupReport(group, outputDir);
    }

    writeFinalReport(outputDir, groups);
}

main();
