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
    let measurementsReconstructed = reconstructOldMeasurements(measurements, statistics);
    let outputDirectory = path.join(outputDir, id.directoryName)

    console.log('generating plots and report for', title);
    let reportDir = path.join(outputDirectory, "report");
    fs.mkdirSync(reportDir, {recursive: true});

    let estimates = measurementsReconstructed.absoluteEstimates;
    let distributions = measurementsReconstructed.distributions;

    let typical_estimate =
        estimates.slope ??
        estimates.mean;

    let timeInterval = (est) => {
        let {lowerBound, upperBound} = est.confidenceInterval;
        return {
            lower: formatMeasurement(lowerBound),
            point: formatMeasurement(est.pointEstimate),
            upper: formatMeasurement(upperBound),
        }
    };
    let r2Interval = (est) => {
        let {lowerBound, upperBound} = est.confidenceInterval;
        let format = x => Slope.rSquared(x, data).toFixed(7);
        return {
            lower: format(lowerBound),
            point: format(est.pointEstimate),
            upper: format(upperBound),
        };
    };

    let data = measurementsReconstructed.data;

    GnuPlotter.pdfSmall(reportDir, measurementsReconstructed);
    GnuPlotter.pdf(title, reportDir, measurementsReconstructed);

    GnuPlotter.regressionSmall(reportDir, measurementsReconstructed);
    GnuPlotter.regression(title, reportDir, measurementsReconstructed);

    GnuPlotter.statistic(title, reportDir, 'Mean', 'mean.svg', distributions.mean, estimates.mean);
    GnuPlotter.statistic(title, reportDir, 'Median', 'median.svg', distributions.median, estimates.median);
    GnuPlotter.statistic(title, reportDir, 'Std. Dev.', 'stdDev.svg', distributions.stdDev, estimates.stdDev);
    GnuPlotter.statistic(title, reportDir, 'MAD', 'mad.svg', distributions.medianAbsDev, estimates.medianAbsDev);
    GnuPlotter.statistic(title, reportDir, 'Slope', 'slope.svg', distributions.slope, estimates.slope);

    let context = {
        title: title,
        confidence: typical_estimate.confidenceInterval.confidenceLevel.toFixed(2),

        additionalStatistics: [
            {name: "Mean", ...timeInterval(estimates.mean)},
            {name: "Median", ...timeInterval(estimates.median)},
            {name: "Std. Dev.", ...timeInterval(estimates.stdDev)},
            {name: "Slope", ...timeInterval(estimates.slope)},
            {name: "MAD", ...timeInterval(estimates.medianAbsDev)},
            {name: "R²", ...r2Interval(typical_estimate)},
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

    GnuPlotter.violin(reportDir, group.funcs, group.allCurves);

    let context = {
        name: group.name,
        benchmarks: group.benchmarks // name + path
    };

    let report_path = path.join(reportDir, 'index.html');
    let report = renderTemplate('summary_report', context);
    fs.writeFileSync(report_path, report)
}

function reconstructOldMeasurements(measurements, statistics) {
    return {
        data: {
            xs: measurements.iters,
            ys: measurements.times,
        },
        avgTimes: {
            fences: measurements.tukey,
            sample: {
                numbers: measurements.averages,
            }
        },
        absoluteEstimates: Object.fromEntries(Object.keys(statistics).map(statistic =>
            [statistic, {
                confidenceInterval: {
                    confidenceLevel: statistics[statistic].estimates.cl,
                    lowerBound: statistics[statistic].estimates.lb,
                    upperBound: statistics[statistic].estimates.ub
                },
                standardError: statistics[statistic].estimates.se,
                pointEstimate: statistics[statistic].estimates.point,
            }])),
        distributions: Object.fromEntries(Object.keys(statistics).map(statistic => [
            statistic, {
                numbers: statistics[statistic].bootstrap
            }
        ]))
    };
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

    let functionIds = [];
    let curvesById = {};
    for (let benchmark of group) {
        let functionId = benchmark.id.functionId;
        functionIds.push(functionId);
        curvesById[functionId] = benchmark.measurements.averages;
    }

    let benchmarks = Array.from(new Set(functionIds))
        .sort()
        .map((f) => ({
            name: f,
            path: path.join(outputDir, slugify(groupId), slugify(f))
        }));

    let allCurves = Object.values(curvesById);
    let funcs = Object.keys(curvesById);
    return {
        name: groupId,
        path: path.join(outputDir, slugify(groupId), "report", "index.html"),
        funcs,
        allCurves,
        benchmarks
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
