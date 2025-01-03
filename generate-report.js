#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {BenchmarkId, slugify} from "./index.js";
import {renderTemplate} from "./templates.js";
import {Slope} from "./analysis.js";
import {formatMeasurement, HtmlBenchmarkGroup, JsonReport} from "./report.js";
import {GnuPlotter} from "./gnuplotter.js";


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
        confidence:
            typical_estimate.confidenceInterval.confidenceLevel.toFixed(2),
        thumbnail_width: 450,
        thumbnail_height: 300,

        slope: estimates.slope
            ? time_interval(estimates.slope)
            : null,
        mean: time_interval(estimates.mean),
        median: time_interval(estimates.median),
        mad: time_interval(estimates.medianAbsDev),
        std_dev: time_interval(estimates.stdDev),
        r2: {
            lower: Slope.rSquared(
                typical_estimate.confidenceInterval.lowerBound,
                data,
            ).toFixed(7),
            point: Slope.rSquared(typical_estimate.pointEstimate, data).toFixed(7),
            upper: Slope.rSquared(
                typical_estimate.confidenceInterval.upperBound,
                data,
            ).toFixed(7),
        },
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
        group_id: group.groupReport.name,
        groupReport: group.groupReport,

        thumbnail_width: 450,
        thumbnail_height: 300,

        // line_chart: line_path.map(|p| p.to_string_lossy().into_owned()),

        benchmarks: group.functionLinks,
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

async function main() {
    if (process.argv.length !== 3 || !fs.existsSync(process.argv[2])) {
        console.error("usage: npx criterion-report path_to_criterion_folder");
        process.exit(1);
    }
    let outputDir = process.argv[2];

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
    let idGroups = {};
    for (let benchmark of benchmarks) {
        let group = idGroups[benchmark.groupId] || [];
        group.push(benchmark);
        idGroups[benchmark.groupId] = group;
    }

    let groups = Object.values(idGroups).map((group) =>
        HtmlBenchmarkGroup.fromGroup(outputDir, group),
    );
    groups.sort((a, b) => a.groupReport.name.localeCompare(b.groupReport.name));

    for (let group of groups) {
        generateGroupReport(group, outputDir);
    }

    let reportDir = path.join(outputDir, "report");
    fs.mkdirSync(reportDir, {recursive: true});
    let reportPath = path.join(reportDir, "index.html");

    fs.writeFileSync(
        reportPath,
        renderTemplate("index", {
            groups,
        }),
    );

    console.log("Wrote", reportPath);
}

main();
