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

    measurementComplete(id, _context, reportData) {
        let typicalEstimate = reportData.statistics.slope ?? reportData.statistics.mean;

        console.log(
            `${id.title.padEnd(23)} time:`,
            `[${formatMeasurement(typicalEstimate.estimates.lb)}`,
            formatMeasurement(typicalEstimate.estimates.point),
            `${formatMeasurement(typicalEstimate.estimates.ub)}]`,
        );

        if (reportData.throughput) {
            // TODO
        }

        this.outliers(reportData.measurements.tukey, reportData.measurements.averages);

        let slopeEstimate = reportData.statistics.slope.estimates;

        function formatShortEstimate(estimate) {
            let lb = formatMeasurement(estimate.lb);
            let ub = formatMeasurement(estimate.ub);
            return `[${lb} ${ub}]`;
        }

        let data = {xs: reportData.measurements.iters, ys: reportData.measurements.times};

        if (slopeEstimate) {
            let slop = formatShortEstimate(slopeEstimate);
            let lb = Slope.rSquared(
                slopeEstimate.lb,
                data,
            ).toFixed(7);
            let ub = Slope.rSquared(
                slopeEstimate.ub,
                data,
            ).toFixed(7);
            console.log(`slope  ${slop}`, `R^2            [${lb} ${ub}]`);
        }
        let mean = formatShortEstimate(reportData.statistics.mean.estimates);
        let stdDev = formatShortEstimate(reportData.statistics.stdDev.estimates);
        let median = formatShortEstimate(reportData.statistics.median.estimates);
        let medianAbsDev = formatShortEstimate(
            reportData.statistics.medianAbsDev.estimates,
        );
        console.log(`mean   ${mean} std. dev.      ${stdDev}`);
        console.log(`median ${median} med. abs. dev. ${medianAbsDev}`);
    }

    outliers(fences, numbers) {
        let [los, lom, noa, him, his] = [0, 0, 0, 0, 0];
        let [lost, lomt, himt, hist] = fences;
        for (let n of numbers) {
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
        let sampleSize = numbers.length;
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

export class JsonReport extends Report {

    static VERSION = 2;

    constructor() {
        super();
    }

    measurementComplete(id, context, reportData) {
        let where = path.join(context.outputDirectory, id.directoryName);
        fs.mkdirSync(where, {recursive: true});
        let filePath = path.join(where, "benchmark.json");

        let version = JsonReport.VERSION;
        fs.writeFileSync(filePath, JSON.stringify({version, ...reportData}));
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

    measurementComplete(id, context, reportData) {
        this.reporters.forEach((reporter) =>
            reporter.measurementComplete(id, context, reportData),
        );
    }
}
