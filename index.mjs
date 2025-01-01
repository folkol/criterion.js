import * as Analysis from "./analysis.js";
import {Slope} from "./analysis.js";
import fs from 'node:fs';
import path from 'node:path';

class Bencher {
    constructor(iterated,
                iters,
                value,
                elapsed_time) {
        this.iterated = iterated;
        this.iters = iters;
        this.value = value;
        this.elapsed_time = elapsed_time;
    }

    assertIterated() {
        if (!this.iterated) {
            console.error('Benchmark function must call Bencher.iter.')
        }
        this.iterated = false;
    }

    async iter(f, ...input) {
        this.iterated = true;
        let start = performance.now();
        let sink = null;
        if (typeof f.then === "function") {
            for (let i = 0; i < this.iters; i++) {
                sink = await f(...input);
            }
        } else {
            for (let i = 0; i < this.iters; i++) {
                sink = f(...input)
            }
        }
        blackbox(sink);
        this.elapsed_time = (performance.now() - start) * 1e6;
    }
}

class GroupBenchmarkId {
    name;
    _parameter;

    constructor(name) {
        this.name = name;
    }
}

export class InternalBenchmarkId {
    constructor(groupId, functionId, valueString, throughput) {
        this.groupId = groupId;
        this.functionId = functionId;
        this.valueString = valueString;
        this.throughput = throughput;
        if (groupId && valueString) {
            this.fullId = `${groupId}/${functionId}/${valueString}`;
        } else if (groupId) {
            this.fullId = `${groupId}/${functionId}`;
        } else {
            this.fullId = functionId;
        }
        this.title = this.fullId;
        this.directoryName = this.fullId;
    }
}

function iterationCounts(samplingMode, warmupMeanExecutionTime, sampleCount, targetTime) {
    // if samplingMode == Linear

    let n = sampleCount;
    let met = warmupMeanExecutionTime;
    let m_ns = targetTime;

    // Solve: [d + 2*d + 3*d + ... + n*d] * met = m_ns
    let totalRuns = n * (n + 1) / 2;
    let d = Math.max(1, (Math.ceil(m_ns / met / totalRuns)))
    let expectedNs = totalRuns * d * met;

    if (d === 1) {
        console.error(
            `\nWarning: Unable to complete ${n}`,
            `samples in ${targetTime}.`,
            `You may wish to increase target time to ${expectedNs}`,
        );
    }

    return Array(n).fill(1).map((_, i) => (i + 1) * d)
}

class Function {
    constructor(f) {
        this.f = f;
    }

    async sample(
        id,
        config,
        criterion,
        reportContext,
        parameter
    ) {
        let wu = config.warmUpTime * 1e9;

        criterion.report.warmup(id, reportContext, wu);

        let [elapsed, iters] = await this.warmUp(wu, parameter);

        let met = elapsed / iters;
        let n = config.sampleSize;

        let actualSamplingMode = 'linear'; // TODO
        let mIters = iterationCounts(actualSamplingMode, met, n, config.measurementTime * 1e9);
        let expectedNs = mIters.reduce((acc, x) => acc + x * met);
        let totalIters = mIters.reduce((acc, x) => acc + x);

        criterion.report.measurementStart(id, reportContext, n, expectedNs, totalIters);

        let rawTimes = await this.bench(mIters, parameter);
        let times = rawTimes.map(Math.round)

        return [
            actualSamplingMode,
            mIters,
            times
        ]
    }

    async warmUp(howLong, parameter) {
        let f = this.f;
        let bencher = new Bencher(false, 1, 0, 0)
        let totalIters = 0;
        let elapsedTime = 0;
        while (elapsedTime < howLong) {
            await f(bencher, blackbox(parameter));
            bencher.assertIterated();
            totalIters += bencher.iters;
            elapsedTime += bencher.elapsed_time;
            bencher.iters *= 2;
        }

        return [elapsedTime, totalIters];
    }

    async bench(mIters, parameter) {
        let f = this.f;
        let results = []
        for (let n of mIters) {
            let bencher = new Bencher(false, n, 0, 0)
            await f(bencher, parameter);
            bencher.assertIterated();
            results.push(bencher.elapsed_time);
        }
        return results;
    }
}

/**
 * Class representing a group of related benchmarks.
 * Benchmarks within a group share a common name and are managed together.
 */
class BenchmarkGroup {
    /**
     * The Criterion instance managing this benchmark group.
     * @type {Criterion}
     */
    criterion;

    /**
     * The name of the benchmark group.
     * @type {string}
     */
    name;

    /**
     * Creates an instance of BenchmarkGroup.
     * @param {Criterion} criterion - The Criterion instance managing the benchmark group.
     * @param {string} name - The name of the benchmark group.
     */
    constructor(criterion, name) {
        this.criterion = criterion;
        this.name = name;
    }

    /**
     * Runs a single benchmark within the group.
     * Performs analysis and reporting based on the provided function and input.
     * @param {Object} id - The unique identifier for the benchmark.
     * @param {Function} input - A function to generate inputs for the benchmark.
     * @param {Function} f - The benchmark function to be executed.
     * @returns {Promise<void>} Resolves when the benchmark is complete.
     */
    async runBench(id, input, f) {
        let config = this.criterion.config;
        let reportContext = {
            outputDirectory: this.criterion.outputDirectory,
        };
        let internalId = new InternalBenchmarkId(
            this.name,
            id.name,
            id._parameter,
        );
        let func = new Function(f);

        await Analysis.common(
            internalId,
            func,
            config,
            this.criterion,
            reportContext,
            input
        );
    }

    /**
     * Adds a new benchmark to the group and schedules it for execution.
     * The benchmark is defined by its name and function, and additional parameters can be passed.
     * @param {string} name - The name of the benchmark.
     * @param {Function} f - The function to be benchmarked.
     * @param {...any} rest - Additional parameters for the benchmark function.
     */
    bench(name, f, ...rest) {
        let task = async () => this.runBench(
            new GroupBenchmarkId(name),
            () => blackbox(rest),
            async (b, i) => await b.iter(f, ...i())
        );
        this.criterion.submit(task);
    }
}

class Report {
    benchmarkStart(_id, _context) {
    }

    warmup(_id, _context, _warmupNs) {
    }

    analysis(_id, _context) {
    }

    measurementStart(
        _id,
        _context,
        _sample_count,
        _estimateNs,
        _iterCount,
    ) {
    }

    measurementComplete(
        _id,
        _context,
        _measurements,
        _formatter,
    ) {
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

    values.forEach((v, i, arr) => arr[i] = v * factor)

    return unit;
}

export function formatMeasurement(value) {
    let values = [value];
    let unit = scaleValues(value, values);
    return `${short(values[0]).padEnd(6)} ${unit}`
}

export function short(n) {
    if (n < 10.0) {
        return n.toFixed(4);
    } else if (n < 100.0) {
        return n.toFixed(3);
    } else if (n < 1000.0) {
        return n.toFixed(2);
    } else if (n < 10000.0) {
        return n.toFixed(10)
    } else {
        return n.toFixed(0);
    }
}

function formatTime(ns) {
    if (ns < 1.0) {
        return `${short(ns * 1e3)} ps`.padStart(6);
    } else if (ns < 10 ** 3) {
        return `${short(ns)} ns`.padStart(6)
    } else if (ns < 10 ** 6) {
        return `${short(ns / 1e3)} µs`.padStart(6);
    } else if (ns < 10 ** 9) {
        return `${short(ns / 1e6)} ms`.padStart(6);
    } else {
        return `${short(ns / 1e9)} s`.padStart(6)
    }
}

function formatIterCount(iterations) {
    if (iterations < 10_000) {
        return `${iterations} iterations`;
    } else if (iterations < 1_000_000) {
        return `${(iterations / 1000).toFixed(0)}k iterations`;
    } else if (iterations < 10_000_000) {
        let s = ((iterations) / (1000.0 * 1000.0)).toFixed(1);
        return `${s}M iterations`;
    } else if (iterations < 1_000_000_000) {
        let s = ((iterations) / (1000.0 * 1000.0)).toFixed(1);
        return `${s}M iterations`;
    } else if (iterations < 10_000_000_000) {
        let s = (iterations) / (1000.0 * 1000.0 * 1000.0).toFixed(1);
        return `${s}B iterations`;
    } else {
        let s = (iterations / (1000.0 * 1000.0 * 1000.0)).toFixed(0);
        return `${s}B iterations`;
    }
}

class CliReport extends Report {
    benchmarkStart(id, _context) {
        console.log('Benchmarking', id.title);
    }

    analysis(id, _context) {
        console.log(`Benchmarking ${id.title}: Analyzing`);
    }

    warmup(id, _context, warmupNs) {
        console.log(`Benchmarking ${id.title}: Warming up for ${formatTime(warmupNs)}`)
    }

    measurementStart(_id, _context, _sample_count, _estimate_ns, _iter_count) {
        console.log(
            `Benchmarking ${_id.title}:`,
            `Collecting ${_sample_count} samples in estimated`,
            `${formatTime(_estimate_ns)} (${formatIterCount(_iter_count)})`
        )
    }

    measurementComplete(id, _context, measurements, formatter) {
        let typicalEstimate = measurements.absoluteEstimates.typical();

        console.log(
            `${id.title.padEnd(23)} time:`,
            `[${formatMeasurement(typicalEstimate.confidence_interval.lower_bound)}`,
            formatMeasurement(typicalEstimate.point_estimate),
            `${formatMeasurement(typicalEstimate.confidence_interval.upper_bound)}]`
        )

        if (measurements.throughput) {
            // TODO
        }

        this.outliers(measurements.avgTimes)

        let slopeEstimate = measurements.absoluteEstimates.slope;

        function formatShortEstimate(estimate) {
            let lb = formatMeasurement(estimate.confidence_interval.lower_bound);
            let ub = formatMeasurement(estimate.confidence_interval.upper_bound);
            return `[${lb} ${ub}]`;
        }

        if (slopeEstimate) {
            let slop = formatShortEstimate(slopeEstimate);
            let lb = Slope.rSquared(slopeEstimate.confidence_interval.lower_bound, measurements.data).toFixed(7);
            let ub = Slope.rSquared(slopeEstimate.confidence_interval.upper_bound, measurements.data).toFixed(7);
            console.log(`slope  ${slop}`, `R^2            [${lb} ${ub}]`)
        }
        let mean = formatShortEstimate(measurements.absoluteEstimates.mean);
        let stdDev = formatShortEstimate(measurements.absoluteEstimates.stdDev);
        let median = formatShortEstimate(measurements.absoluteEstimates.median);
        let medianAbsDev = formatShortEstimate(measurements.absoluteEstimates.medianAbsDev);
        console.log(`mean   ${mean} std. dev.      ${stdDev}`)
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
                noa += 1
            }
        }
        // return [los, lom, noa, him, his];
        let numOutliers = los + lom + him + his;
        let sampleSize = labeledSample.sample.numbers.length;
        if (numOutliers === 0) {
            return;
        }

        let percent = n => 100 * n / sampleSize;

        console.log(`Found ${numOutliers} outliers among ${sampleSize} measurements (${percent(numOutliers)}%)`)
        let print = (n, label) => {
            if (n !== 0) {
                console.log(`  ${n} (${percent(n).toFixed(2)}%) ${label}`);
            }
        }
        print(los, "low severe");
        print(him, "low mild");
        print(him, "high mild");
        print(his, "high severe");
    };
}

class ReportLink {
    constructor(name, pathOrNull) {
        this.name = name;
        this.pathOrNull = pathOrNull;
    }

    static group(outputDir, groupId) {
        let reportPath = path.join(outputDir, groupId, 'report', 'index.html')
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(groupId, pathOrNull)
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
        this.outputDir = outputDir;
        this.group = group;
        let groupId = group[0].groupId;
        let groupReport = ReportLink.group(outputDir, groupId);
        let functionIds = [];
        let values = [];
        let individualLinks = new Map;
        for (let id of group) {
            let functionId = id.functionId;
            let value = id.value;
            let individualLink = ReportLink.individual(outputDir, id);
            functionIds.push(functionId);
            values.push(value);
            individualLinks.set(`${functionId}-${value}`, individualLink);
        }

        let uniqueSortedValues = [...new Set(values)];
        if (values.every(x => typeof x === 'number')) {
            uniqueSortedValues.sort((a, b) => b - a);
        } else {
            uniqueSortedValues.sort()
        }

        let uniqueSortedFunctionIds = [...new Set(functionIds)].toSorted();
        let valueGroups = [];
        for (let value of uniqueSortedValues) {
            let row = new Set;
            for (let functionId of uniqueSortedFunctionIds) {
                let key = `${functionId}-${value}`;
                let link = individualLinks.get(key);
                if (link) {
                    individualLinks.delete(key);
                    row.add(link);
                }
            }
            let valueOrNull = value ? ReportLink.value(outputDir, groupId, value) : null;
            valueGroups.push(new BenchmarkValueGroup(valueOrNull, [...row].toSorted()));
        }

        let functionLinks = uniqueSortedFunctionIds.map(f => ReportLink.function(outputDir, groupId, f));
        let valueLinks = uniqueSortedValues.map(value => value ? ReportLink.value(outputDir, groupId, value) : null);

        return new HtmlBenchmarkGroup(groupReport, functionLinks, valueLinks, valueGroups)
    }
}

class JsonReport extends Report {
    constructor() {
        super();
    }

    measurementComplete(_id, _context, _measurements, _formatter) {
        // TODO: just write the data needed and render the report in another program?

        let report_dir = path.join(
            _context.outputDirectory,
            _id.directoryName,
            'report'
        )
        fs.mkdirSync(report_dir, {recursive: true});
        let filePath = path.join(
            _context.outputDirectory,
            _id.directoryName,
            "measurements.json");
        fs.writeFileSync(filePath, JSON.stringify(_measurements));
    }

}

/**
 * Configuration class for benchmarking settings in Criterion.
 * Allows customization of key parameters such as confidence level, measurement time, and sampling.
 */
class CriterionConfig {
    /**
     * The confidence level used in statistical calculations.
     * Represents the probability that the true parameter is within the confidence interval.
     * @type {number}
     * @default 0.95
     */
    confidenceLevel = 0.95;

    /**
     * The duration (in seconds) for which measurements are taken during benchmarking.
     * @type {number}
     * @default 5
     */
    measurementTime = 5;

    /**
     * The number of resamples performed during bootstrap analysis.
     * Higher values increase precision but require more computation.
     * @type {number}
     * @default 100000
     */
    nResamples = 100_000;

    /**
     * The number of samples collected during each benchmark iteration.
     * @type {number}
     * @default 100
     */
    sampleSize = 100;

    /**
     * The warm-up time (in seconds) before actual measurements begin.
     * Allows the system to stabilize for more accurate results.
     * @type {number}
     * @default 3
     */
    warmUpTime = 3;

    /**
     * Creates an instance of CriterionConfig.
     * Merges the provided options with the default configuration.
     * @param {Object} [opts] - An object containing custom configuration options.
     * @param {number} [opts.confidenceLevel] - Custom confidence level.
     * @param {number} [opts.measurementTime] - Custom measurement time in seconds.
     * @param {number} [opts.nResamples] - Custom number of resamples.
     * @param {number} [opts.sampleSize] - Custom sample size.
     * @param {number} [opts.warmUpTime] - Custom warm-up time in seconds.
     */
    constructor(opts) {
        Object.assign(this, opts);
    }
}


export class Reporter extends Report {
    constructor(...reporters) {
        super();
        this.reporters = reporters;
    }

    benchmarkStart(id, ctx) {
        this.reporters.forEach(reporter => reporter.benchmarkStart(id, ctx))
    }

    analysis(id, context) {
        this.reporters.forEach(reporter => reporter.analysis(id, context))
    }

    warmup(id, context, wu) {
        this.reporters.forEach(reporter => reporter.warmup(id, context, wu))
    }

    measurementStart(id, context, sampleCount, estimateNs, iterCount) {
        this.reporters.forEach(reporter => reporter.measurementStart(id, context, sampleCount, estimateNs, iterCount))
    }

    measurementComplete(id, context, measurements, formatter) {
        this.reporters.forEach(reporter => reporter.measurementComplete(id, context, measurements, formatter))
    }
}



/**
 * The main API for Criterion.js
 * Manages task execution and reporting for benchmarking tasks.
 */
export class Criterion {
    queue = [];

    /**
     * The maximum number of tasks that can run concurrently.
     * @type {number}
     * @default 1
     */
    concurrency = 1;

    running = 0;

    report = new Reporter(new CliReport, new JsonReport);

    outputDirectory = 'criterion';

    // measurement = new WallTime;

    config;

    /**
     * Creates an instance of Criterion.
     * @param {Object} configuration - Configuration overrides
     */
    constructor(configuration) {
        this.config = new CriterionConfig(configuration);
    }

    /**
     * Creates a new benchmark group with a specified name.
     * Benchmark groups allow grouping of related benchmarks for organization.
     * @param {string} name - The name of the benchmark group.
     * @returns {BenchmarkGroup} A new BenchmarkGroup instance.
     */
    benchmarkGroup(name) {
        return new BenchmarkGroup(this, name);
    }

    async runTask(task) {
        if (this.running >= this.concurrency) {
            await new Promise(resolve => this.queue.push(resolve));
        }
        this.running++;
        try {
            await task();
        } finally {
            this.running--;
            if (this.queue.length > 0) {
                this.queue.shift()();
            }
        }
    }

    submit(task) {
        return this.runTask(task);
    }
}

export function blackbox(x) {
    globalThis.sink = x;
    return x
}
