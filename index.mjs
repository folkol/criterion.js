import * as Analysis from "./analysis.mjs";
import {Reporter} from "./report.mjs";

function blackbox(x) {
    globalThis.__criterionBlackboxSink = x;
    return x;
}

class Bencher {
    iterated = false;
    value = 0;
    elapsedNs = 0;

    constructor(iters) {
        this.iters = iters;
    }

    assertIterated() {
        if (!this.iterated) {
            console.error("Benchmark function must call Bencher.iter.");
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
                sink = f(...input);
            }
        }
        blackbox(sink);
        this.elapsedNs = (performance.now() - start) * 1e6;
    }
}

export class BenchmarkId {
    constructor(groupId, functionId) {
        this.groupId = groupId;
        this.functionId = functionId;
        this.fullId = `${groupId}/${functionId}`;
        this.title = this.fullId;
        this.directoryName = this.fullId; // TODO slug?
    }
}

class BenchmarkTarget {
    constructor(func) {
        this.func = func;
    }

    iterationCounts(warmupMeanExecutionTime, sampleCount, targetTime) {
        let n = sampleCount;
        let met = warmupMeanExecutionTime;

        // Solve: [d + 2*d + 3*d + ... + n*d] * met = targetTime
        let totalRuns = (n * (n + 1)) / 2;
        let d = Math.max(1, Math.ceil(targetTime / met / totalRuns));
        let expectedNs = totalRuns * d * met;

        if (d === 1) {
            let suggestedTime = Math.ceil(expectedNs / 1e9);
            console.error(
                `Warning: Unable to complete ${n} samples in ${targetTime / 1e9}.`,
                `You may wish to increase target time to ~${suggestedTime} s.`,
            );
        }

        let iterations = [];
        for (let i = 1; i <= n; i++) {
            iterations.push(i * d);
        }
        return iterations;
    }

    async sample(id, config, criterion, reportContext, input) {
        let wu = config.warmUpTime * 1e9;

        criterion.report.warmup(id, reportContext, wu);

        let meanExecutionTime = await this.warmUp(wu, input);

        let n = config.sampleSize;

        let iters = this.iterationCounts(
            meanExecutionTime,
            n,
            config.measurementTime * 1e9,
        );
        let totalIters = iters.reduce((acc, x) => acc + x);
        let expectedNs = totalIters * meanExecutionTime;

        criterion.report.measurementStart(
            id,
            reportContext,
            n,
            expectedNs,
            totalIters,
        );

        let results = await this.bench(iters, input);
        let times = results.map(Math.round);

        return [iters, times];
    }

    async warmUp(howLong, input) {
        let f = this.func;
        let bencher = new Bencher(1);
        let totalIters = 0;
        let elapsedNs = 0;
        while (elapsedNs < howLong) {
            await f(bencher, blackbox(input));
            bencher.assertIterated();
            totalIters += bencher.iters;
            elapsedNs += bencher.elapsedNs;
            bencher.iters *= 2;
        }

        return elapsedNs / totalIters;
    }

    async bench(iters, parameter) {
        let f = this.func;
        let results = [];
        for (let n of iters) {
            let bencher = new Bencher(n);
            await f(bencher, parameter);
            bencher.assertIterated();
            results.push(bencher.elapsedNs);
        }
        return results;
    }
}

/**
 * A group of related benchmarks. Typically alternative implementations of the same function.
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
            outputDirectory: this.criterion.config.outputDirectory,
        };
        let target = new BenchmarkTarget(f);

        await Analysis.common(
            id,
            target,
            config,
            this.criterion,
            reportContext,
            input,
        );
    }

    /**
     * Adds a new benchmark to the group and schedules it for execution.
     * @param {string} name - The name of the benchmark.
     * @param {BenchmarkTarget} f - The function to be benchmarked.
     * @param {...any} rest - Additional parameters for the benchmark function.
     */
    bench(name, f, ...rest) {
        let task = async () =>
            this.runBench(
                new BenchmarkId(this.name, name),
                () => blackbox(rest),
                async (b, i) => await b.iter(f, ...i()),
            );
        this.criterion.submit(task);
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
     * Directory where to store the output files.
     * @type {string}
     * @default criterion
     */
    outputDirectory = "criterion";

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

/**
 * The main API for Criterion.js
 * Manages task execution and reporting for benchmarking tasks.
 */
export class Criterion {
    numRunning = 0;
    report = new Reporter;
    queue = [];

    /**
     * Creates an instance of Criterion.
     * @param {Object} configuration - Configuration overrides
     */
    constructor(configuration) {
        this.config = new CriterionConfig(configuration);
    }

    /**
     * Creates a new benchmark group with a specified name.
     * Typically alternative implementations of the same functionality.
     * @param {string} name - The name of the benchmark group.
     * @returns {BenchmarkGroup} A new BenchmarkGroup instance.
     */
    group(name) {
        return new BenchmarkGroup(this, name);
    }

    async runTask(task) {
        if (this.numRunning > 0) {
            await new Promise((resolve) => this.queue.push(resolve));
        }
        this.numRunning++;
        try {
            await task();
        } finally {
            this.numRunning--;
            if (this.queue.length > 0) {
                let resolve = this.queue.shift();
                resolve();
            }
        }
    }

    submit(task) {
        return this.runTask(task);
    }
}

// Would this work?
let defaultCriterion = new Criterion({warmUpTime: 0.1, measurementTime: 0.1})
let currentGroup = defaultCriterion.group('default');
let groupNameStack = [];

export function group(name, cb) {
    groupNameStack.push(name)
    currentGroup = defaultCriterion.group(groupNameStack.join('_'))
    cb()
    groupNameStack.pop();
}

export function bench(name, f, ...rest) {
    currentGroup.bench(name, f, ...rest);
}
