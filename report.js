import {Slope} from "./analysis.js";
import path from 'node:path';
import fs from 'node:fs';

export class Report {
    benchmarkStart(_id, _context) {
    }

    warmup(_id, _context, _warmupNs) {
    }

    analysis(_id, _context) {
    }

    measurementStart(_id, _context, _sample_count, _estimateNs, _iterCount) {
    }

    measurementComplete(_id, _context, _measurements, _formatter) {
    }
}

export function scaleValues(ns, values) {
    let factor, unit;
    if (ns < 10 ** 0) {
        [factor, unit] = [10 ** 3, "ps"];
    } else if (ns < 10 ** 3) {
        [factor, unit] = [10 ** 0, "ns"];
    } else if (ns < 10 ** 6) {
        [factor, unit] = [10 ** -3, "µs"];
    } else if (ns < 10 ** 9) {
        [factor, unit] = [10 ** -6, "ms"];
    } else {
        [factor, unit] = [10 ** -9, "s"];
    }

    values.forEach((v, i, arr) => (arr[i] = v * factor));

    return unit;
}

export function formatShort(n) {
    if (n < 10.0) {
        return n.toFixed(4);
    } else if (n < 100.0) {
        return n.toFixed(3);
    } else if (n < 1000.0) {
        return n.toFixed(2);
    } else if (n < 10000.0) {
        return n.toFixed(10);
    } else {
        return n.toFixed(0);
    }
}

export function formatMeasurement(value) {
    let values = [value];
    let unit = scaleValues(value, values);
    return `${formatShort(values[0]).padEnd(6)} ${unit}`;
}

function formatTime(ns) {
    if (ns < 1.0) {
        return `${formatShort(ns * 1e3)} ps`.padStart(6);
    } else if (ns < 10 ** 3) {
        return `${formatShort(ns)} ns`.padStart(6);
    } else if (ns < 10 ** 6) {
        return `${formatShort(ns / 1e3)} µs`.padStart(6);
    } else if (ns < 10 ** 9) {
        return `${formatShort(ns / 1e6)} ms`.padStart(6);
    } else {
        return `${formatShort(ns / 1e9)} s`.padStart(6);
    }
}

function formatIterCount(iterations) {
    if (iterations < 10_000) {
        return `${iterations} iterations`;
    } else if (iterations < 1_000_000) {
        return `${(iterations / 1000).toFixed(0)}k iterations`;
    } else if (iterations < 10_000_000) {
        let s = (iterations / (1000.0 * 1000.0)).toFixed(1);
        return `${s}M iterations`;
    } else if (iterations < 1_000_000_000) {
        let s = (iterations / (1000.0 * 1000.0)).toFixed(1);
        return `${s}M iterations`;
    } else if (iterations < 10_000_000_000) {
        let s = iterations / (1000.0 * 1000.0 * 1000.0).toFixed(1);
        return `${s}B iterations`;
    } else {
        let s = (iterations / (1000.0 * 1000.0 * 1000.0)).toFixed(0);
        return `${s}B iterations`;
    }
}

export class CliReport extends Report {
    benchmarkStart(id, _context) {
        console.log("Benchmarking", id.title);
    }

    analysis(id, _context) {
        console.log(`Benchmarking ${id.title}: Analyzing`);
    }

    warmup(id, _context, warmupNs) {
        console.log(
            `Benchmarking ${id.title}: Warming up for ${formatTime(warmupNs)}`,
        );
    }

    measurementStart(id, _context, sampleCount, estimateNs, iterCount) {
        console.log(
            `Benchmarking ${id.title}:`,
            `Collecting ${sampleCount} samples in estimated`,
            `${formatTime(estimateNs)} (${formatIterCount(iterCount)})`,
        );
    }

    measurementComplete(id, _context, measurements) {
        let typicalEstimate = measurements.absoluteEstimates.typical();

        let {lowerBound, upperBound} = typicalEstimate.confidenceInterval;
        console.log(
            `${id.title.padEnd(23)} time:`,
            `[${formatMeasurement(lowerBound)}`,
            formatMeasurement(typicalEstimate.pointEstimate),
            `${formatMeasurement(upperBound)}]`,
        );

        if (measurements.throughput) {
            // TODO
        }

        this.outliers(measurements.avgTimes);

        let slopeEstimate = measurements.absoluteEstimates.slope;

        function formatShortEstimate(estimate) {
            let lb = formatMeasurement(
                estimate.confidenceInterval.lowerBound,
            );
            let ub = formatMeasurement(
                estimate.confidenceInterval.upperBound,
            );
            return `[${lb} ${ub}]`;
        }

        if (slopeEstimate) {
            let slop = formatShortEstimate(slopeEstimate);
            let lb = Slope.rSquared(
                slopeEstimate.confidenceInterval.lowerBound,
                measurements.data,
            ).toFixed(7);
            let ub = Slope.rSquared(
                slopeEstimate.confidenceInterval.upperBound,
                measurements.data,
            ).toFixed(7);
            console.log(`slope  ${slop}`, `R^2            [${lb} ${ub}]`);
        }
        let mean = formatShortEstimate(measurements.absoluteEstimates.mean);
        let stdDev = formatShortEstimate(measurements.absoluteEstimates.stdDev);
        let median = formatShortEstimate(measurements.absoluteEstimates.median);
        let medianAbsDev = formatShortEstimate(
            measurements.absoluteEstimates.medianAbsDev,
        );
        console.log(`mean   ${mean} std. dev.      ${stdDev}`);
        console.log(`median ${median} med. abs. dev. ${medianAbsDev}`);
    }

    outliers(labeledSample) {
        let [los, lom, noa, him, his] = [0, 0, 0, 0, 0];
        let [lost, lomt, himt, hist] = labeledSample.fences;
        for (let n of labeledSample.sample.numbers) {
            if (n < lost) {
                los += 1;
            } else if (n > hist) {
                his += 1;
            } else if (n < lomt) {
                lom += 1;
            } else if (n > himt) {
                him += 1;
            } else {
                noa += 1;
            }
        }
        // return [los, lom, noa, him, his];
        let numOutliers = los + lom + him + his;
        let sampleSize = labeledSample.sample.numbers.length;
        if (numOutliers === 0) {
            return;
        }

        let percent = (n) => (100 * n) / sampleSize;

        console.log(
            `Found ${numOutliers} outliers among ${sampleSize} measurements (${percent(numOutliers)}%)`,
        );
        let print = (n, label) => {
            if (n !== 0) {
                console.log(`  ${n} (${percent(n).toFixed(2)}%) ${label}`);
            }
        };
        print(los, "low severe");
        print(him, "low mild");
        print(him, "high mild");
        print(his, "high severe");
    }
}

class ReportLink {
    constructor(name, pathOrNull) {
        this.name = name;
        this.pathOrNull = pathOrNull;
    }

    static group(outputDir, groupId) {
        let reportPath = path.join(outputDir, groupId, "report", "index.html");
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(groupId, pathOrNull);
    }

    static individual(outputDir, id) {
        let reportPath = id.directoryName;
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(id.title, pathOrNull);
    }

    static value(outputDir, groupId, value) {
        let reportPath = path.join(outputDir, groupId, value);
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(value, pathOrNull);
    }

    static function(outputDir, groupId, f) {
        let reportPath = path.join(outputDir, groupId, f);
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
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
    constructor(groupReport, functionLinks, valueLinks, individualLinks) {
        this.groupReport = groupReport;
        this.functionLinks = functionLinks;
        this.valueLinks = valueLinks;
        this.valueGroups = individualLinks;
    }

    static fromGroup(outputDir, group) {
        let groupId = group[0].groupId;
        let groupReport = ReportLink.group(outputDir, groupId);
        let functionIds = [];
        let values = [];
        let individualLinks = new Map();
        for (let id of group) {
            let functionId = id.functionId;
            let value = id.value;
            let individualLink = ReportLink.individual(outputDir, id);
            functionIds.push(functionId);
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
            valueGroups,
        );
    }
}

export class JsonReport extends Report {
    constructor() {
        super();
    }

    measurementComplete(id, context, measurements) {
        let where = path.join(context.outputDirectory, id.directoryName);
        fs.mkdirSync(where, {recursive: true});
        let filePath = path.join(where, "benchmark.json");
        fs.writeFileSync(filePath, JSON.stringify({id, measurements}));
    }
}

export class Reporter extends Report {
    constructor() {
        super();
        this.reporters = [new CliReport, new JsonReport];
    }

    benchmarkStart(id, ctx) {
        this.reporters.forEach((reporter) => reporter.benchmarkStart(id, ctx));
    }

    analysis(id, context) {
        this.reporters.forEach((reporter) => reporter.analysis(id, context));
    }

    warmup(id, context, wu) {
        this.reporters.forEach((reporter) => reporter.warmup(id, context, wu));
    }

    measurementStart(id, context, sampleCount, estimateNs, iterCount) {
        this.reporters.forEach((reporter) =>
            reporter.measurementStart(
                id,
                context,
                sampleCount,
                estimateNs,
                iterCount,
            ),
        );
    }

    measurementComplete(id, context, measurements) {
        this.reporters.forEach((reporter) =>
            reporter.measurementComplete(id, context, measurements),
        );
    }
}
