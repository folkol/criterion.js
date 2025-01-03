/**
 * Experimental 'Jasminesque' API for creating a group.
 * Uses a default-configured Criterion instance.
 *
 * See examples/jasminesque.js.
  */
export function group(name: any, cb: any): void;
/**
 * Experimental 'Jasminesque' API for benching a function.
 * Uses a default-configured Criterion instance and possibly
 * a default group.
 *
 * See examples/jasminesque.js.
 */
export function bench(name: any, f: any, ...rest: any[]): void;
/**
 * The main API for Criterion.js
 * Manages task execution and reporting for benchmarking tasks.
 */
export class Criterion {
    /**
     * Creates an instance of Criterion.
     * @param {Object} [configuration] - Configuration overrides
     */
    constructor(configuration?: Partial<CriterionConfig>);
    /**
     * Creates a new benchmark group with a specified name.
     * Typically alternative implementations of the same thing.
     * @param {string} name - The name of the benchmark group.
     * @returns {BenchmarkGroup} A new BenchmarkGroup instance.
     */
    group(name: string): BenchmarkGroup;
}
/**
 * Configuration class for benchmarking settings in Criterion.
 * Allows customization of key parameters such as confidence level, measurement time, and sampling.
 */
declare class CriterionConfig {
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
    constructor(opts?: {
        confidenceLevel?: number;
        measurementTime?: number;
        nResamples?: number;
        sampleSize?: number;
        warmUpTime?: number;
    });
    /**
     * The confidence level used in statistical calculations.
     * Represents the probability that the true parameter is within the confidence interval.
     * @type {number}
     * @default 0.95
     */
    confidenceLevel: number;
    /**
     * The duration (in seconds) for which measurements are taken during benchmarking.
     * @type {number}
     * @default 5
     */
    measurementTime: number;
    /**
     * The number of resamples performed during bootstrap analysis.
     * Higher values increase precision but require more computation.
     * @type {number}
     * @default 100000
     */
    nResamples: number;
    /**
     * The number of samples collected during each benchmark iteration.
     * @type {number}
     * @default 100
     */
    sampleSize: number;
    /**
     * The warm-up time (in seconds) before actual measurements begin.
     * Allows the system to stabilize for more accurate results.
     * @type {number}
     * @default 3
     */
    warmUpTime: number;
    /**
     * Directory where to store the output files.
     * @type {string}
     * @default criterion
     */
    outputDirectory: string;
}
/**
 * A group of related benchmarks. Typically alternative implementations of the same function.
 */
declare class BenchmarkGroup {
    /**
     * Creates an instance of BenchmarkGroup.
     * @param {Criterion} criterion - The Criterion instance managing the benchmark group.
     * @param {string} name - The name of the benchmark group.
     */
    constructor(criterion: Criterion, name: string);
    /**
     * The Criterion instance managing this benchmark group.
     * @type {Criterion}
     */
    criterion: Criterion;
    /**
     * The name of the benchmark group.
     * @type {string}
     */
    name: string;
    /**
     * Adds a new benchmark to the group and schedules it for execution.
     * @param {string} name - The name of the benchmark.
     * @param {function} f - The function to be benchmarked.
     * @param {...any} rest - Additional parameters for the benchmark function.
     */
    bench(name: string, f: (...args: any[]) => any, ...rest: any[]): void;
}
export {};
