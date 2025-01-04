#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {BenchmarkId, slugify} from "./index.js";
import {renderTemplate} from "./templates.js";
import {Slope} from "./analysis.js";
import {formatMeasurement, JsonReport} from "./report.js";
import {GnuPlotter} from "./gnuplotter.js";

class ReportLink {
    constructor(name, pathOrNull) {
        this.name = name;
        this.pathOrNull = pathOrNull;
    }

    static group(outputDir, groupId) {
        let reportPath = path.join(outputDir, slugify(groupId), "report", "index.html");
        // let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(groupId, reportPath);
    }

    static individual(outputDir, id) {
        let reportPath = id.directoryName;
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(id.title, pathOrNull);
    }

    static value(outputDir, groupId, value) {
        let reportPath = path.join(outputDir, slugify(groupId), slugify(value));
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(value, pathOrNull);
    }

    static function(outputDir, groupId, f) {
        let pathOrNull = path.join(outputDir, slugify(groupId), slugify(f));
        return new ReportLink(f, pathOrNull);
    }
}

class BenchmarkValueGroup {
    constructor(value, benchmarks) {
        this.value = value;
        this.benchmarks = benchmarks;
    }
}

export class HtmlBenchmarkGroup {
    constructor(groupReport, functionLinks, valueLinks, individualLinks, measurements) {
        this.groupReport = groupReport;
        this.functionLinks = functionLinks;
        this.valueLinks = valueLinks;
        this.individualLinks = individualLinks;
        this.measurements = measurements;
    }

    static fromGroup(outputDir, group) {
        let groupId = group[0].groupId;
        let groupReport = ReportLink.group(outputDir, groupId);
        let functionIds = [];
        let functionMeasurements = {};
        let values = [];
        let individualLinks = new Map;
        for (let id of group) {
            let functionId = id.functionId;
            let value = id.value;
            let individualLink = ReportLink.individual(outputDir, id);
            functionIds.push(functionId);
            functionMeasurements[functionId] = id.measurements;
            values.push(value);
            individualLinks.set(`${functionId}-${value}`, individualLink);
        }

        let uniqueSortedValues = [...new Set(values)];
        if (values.every((x) => typeof x === "number")) {
            uniqueSortedValues.sort((a, b) => b - a);
        } else {
            uniqueSortedValues.sort();
        }

        let uniqueSortedFunctionIds = [...new Set(functionIds)].toSorted();
        let valueGroups = [];
        for (let value of uniqueSortedValues) {
            let row = new Set();
            for (let functionId of uniqueSortedFunctionIds) {
                let key = `${functionId}-${value}`;
                let link = individualLinks.get(key);
                if (link) {
                    individualLinks.delete(key);
                    row.add(link);
                }
            }
            let valueOrNull = value
                ? ReportLink.value(outputDir, groupId, value)
                : null;
            valueGroups.push(
                new BenchmarkValueGroup(valueOrNull, [...row].toSorted()),
            );
        }

        let functionLinks = uniqueSortedFunctionIds.map((f) =>
            ReportLink.function(outputDir, groupId, f),
        );
        let valueLinks = uniqueSortedValues.map((value) =>
            value ? ReportLink.value(outputDir, groupId, value) : null,
        );

        return new HtmlBenchmarkGroup(
            groupReport,
            functionLinks,
            valueLinks,
            individualLinks,
            functionMeasurements
        );
    }
}


function generatePlotsAndReport(
    measurements,
    title,
    outputDirectory,
) {
    console.log('generating plots and report for', title);
    let reportDir = path.join(outputDirectory, "report");
    fs.mkdirSync(reportDir, {recursive: true});

    let estimates = measurements.absoluteEstimates;
    let distributions = measurements.distributions;

    let typical_estimate =
        estimates.slope ??
        estimates.mean;

    let time_interval = (est) => {
        let {lowerBound, upperBound} = est.confidenceInterval;
        return {
            lower: formatMeasurement(lowerBound),
            point: formatMeasurement(est.pointEstimate),
            upper: formatMeasurement(upperBound),
        }
    };
    let r2_interval = (est) => {
        let {lowerBound, upperBound} = est.confidenceInterval;
        let format = x => Slope.rSquared(x, data).toFixed(7);
        return {
            lower: format(lowerBound),
            point: format(est.pointEstimate),
            upper: format(upperBound),
        };
    };

    let data = measurements.data;

    GnuPlotter.pdfSmall(reportDir, measurements);
    GnuPlotter.pdf(title, reportDir, measurements);

    GnuPlotter.regressionSmall(reportDir, measurements);
    GnuPlotter.regression(title, reportDir, measurements);

    GnuPlotter.statistic(title, reportDir, 'Mean', 'mean.svg', distributions.mean, estimates.mean);
    GnuPlotter.statistic(title, reportDir, 'Median', 'median.svg', distributions.median, estimates.median);
    GnuPlotter.statistic(title, reportDir, 'Std. Dev.', 'stdDev.svg', distributions.stdDev, estimates.stdDev);
    GnuPlotter.statistic(title, reportDir, 'MAD', 'mad.svg', distributions.medianAbsDev, estimates.medianAbsDev);
    GnuPlotter.statistic(title, reportDir, 'Slope', 'slope.svg', distributions.slope, estimates.slope);

    let additional_plots = [
        {url: 'mean.svg', name: 'Mean'},
        {url: 'median.svg', name: 'Median'},
        {url: 'stdDev.svg', name: 'Std. Dev.'},
        {url: 'mad.svg', name: 'MAD'},
        {url: 'slope.svg', name: 'Slope'}
        // new Plot("Typical", "typical.svg"),
    ];

    let context = {
        title: title,
        confidence: typical_estimate.confidenceInterval.confidenceLevel.toFixed(2),

        additional_statistics: [
            {name: "Mean", ...time_interval(estimates.mean)},
            {name: "Median", ...time_interval(estimates.median)},
            {name: "Std. Dev.", ...time_interval(estimates.stdDev)},
            {name: "Slope", ...time_interval(estimates.slope)},
            {name: "MAD", ...time_interval(estimates.medianAbsDev)},
            {name: "R²", ...r2_interval(typical_estimate)},
        ],
        additional_plots,
        comparison: null,
    };

    let report_path = path.join(reportDir, "index.html");
    let output = renderTemplate("benchmark_report", context);
    fs.writeFileSync(report_path, output);
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

function generateGroupReport(group, outputDirectory) {
    let groupId = group.groupReport.name;
    let reportDir = path.join(outputDirectory, slugify(groupId), 'report');
    fs.mkdirSync(reportDir, {recursive: true})

    GnuPlotter.violin(reportDir, group);

    let context = {
        name: group.groupReport.name,
        groupReport: group.groupReport,

        benchmarks: group.functionLinks.map(f => ({
            path: f.pathOrNull,
            name: f.name
        }))
    };

    let report_path = path.join(reportDir, 'index.html');
    let report = renderTemplate('summary_report', context);
    fs.writeFileSync(report_path, report)
}

function reconstructMeasurements(measurements, statistics) {
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

function loadBenchmarks(outputDir) {
    let benchmarkFiles = listBenchmarks(outputDir);

    console.log(`Found ${benchmarkFiles.length} benchmarks.`);

    let benchmarks = [];
    for (let benchmarkFile of benchmarkFiles) {
        let blob = fs.readFileSync(benchmarkFile);
        let {version, groupId, functionId, measurements, statistics} = JSON.parse(blob);
        if (version < JsonReport.VERSION || version === undefined) {
            console.error('[WARN] benchmark data in old format, skipping:', benchmarkFile)
            continue;
        } else if (version !== JsonReport.VERSION) {
            console.error(`[WARN] unknown benchmark version '${version}', current version is '${JsonReport.VERSION}' skipping:`, benchmarkFile)
            continue;
        }
        let measurementsReconstructed = reconstructMeasurements(measurements, statistics);

        let internalBenchmarkId = new BenchmarkId(
            groupId, functionId, measurementsReconstructed,
        );
        generatePlotsAndReport(measurementsReconstructed, internalBenchmarkId.title, path.join(outputDir, internalBenchmarkId.directoryName));
        benchmarks.push(internalBenchmarkId);
    }

    benchmarks.sort((a, b) => a.fullId.localeCompare(b.fullId));

    return benchmarks;
}

function writeFinalReport(outputDir, groups) {
    let reportDir = path.join(outputDir, "report");
    fs.mkdirSync(reportDir, {recursive: true});
    let reportPath = path.join(reportDir, "index.html");

    let context = {
        groups: groups.map(group => ({
            path: group.groupReport.pathOrNull,
            name: group.groupReport.name,
            benchmarks: group.functionLinks.map(f => ({
                path: f.pathOrNull,
                name: f.name
            }))
        }))
    };

    fs.writeFileSync(
        reportPath,
        renderTemplate("index", context),
    );

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

async function main() {
    let outputDir = outputDirOrDie();

    let idGroups = {};
    for (let benchmark of loadBenchmarks(outputDir)) {
        (idGroups[benchmark.groupId] ??= []).push(benchmark)
    }

    let groups = Object.values(idGroups).map((group) =>
        HtmlBenchmarkGroup.fromGroup(outputDir, group),
    );
    groups.sort((a, b) => a.groupReport.name.localeCompare(b.groupReport.name));

    for (let group of groups) {
        generateGroupReport(group, outputDir);
    }

    writeFinalReport(outputDir, groups);
}

main();
