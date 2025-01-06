import {bench} from '../index.js';
import {performance, PerformanceObserver} from 'node:perf_hooks';
import Benchmark from 'benchmark'
import * as TinyBench from 'tinybench'


function empty() {
}

async function emptyAsync() {
}

function trivial(x) {
    return 1 / Math.sqrt(Math.exp(x ** 2) * 2 * Math.PI);
}

async function trivialAsync(x) {
    return 1 / Math.sqrt(Math.exp(x ** 2) * 2 * Math.PI);
}

function medium(xs) {
    return xs.reduce(((acc, x) => acc + trivial(x)))
}

async function mediumAsync(xs) {
    return xs.reduce(((acc, x) => acc + trivial(x)))
}

function large(xs) {
    let result = 0;
    for (let i = 0; i < xs.length; i++) {
        for (let j = 0; j < xs.length; j++) {
            result += i * j;
        }
    }
    return result;
}

async function largeAsync(xs) {
    let result = 0;
    for (let i = 0; i < xs.length; i++) {
        for (let j = 0; j < xs.length; j++) {
            result += i * j;
        }
    }
    return result;
}

function deferred() {
    return new Promise(resolve => setTimeout(resolve, 1000 / 250));
}

async function deferredAsync() {
    return new Promise(resolve => setTimeout(resolve, 1000 / 250));
}

let numbers = Array.from({length: 1000}, Math.random);

async function tinyTest() {
    const bench = new TinyBench.Bench;

    bench
        .add('empty', empty)
        .add('emptyAsync', emptyAsync)
        .add('trivial', () => trivial(100))
        .add('trivialAsync', async () => trivialAsync(100))
        .add('medium', () => medium(numbers))
        .add('mediumAsync', async () => mediumAsync(numbers))
        .add('large', () => large(numbers))
        .add('largeAsync', async () => largeAsync(numbers))
        .add('deferred', async () => deferred())
        .add('deferredAsync', async () => deferredAsync());

    await bench.run()

    console.table(bench.table())
}

async function benchmarkTest() {
    let suite = new Benchmark.Suite;

    suite
        .add('empty', empty)
        .add('emptyAsync', {
            defer: true,
            fn: deferred => emptyAsync().then(deferred.resolve.bind(deferred))
        })
        .add('trivial', () => trivial(100))
        .add('trivialAsync', {
            defer: true,
            fn: deferred => trivialAsync(100).then(deferred.resolve.bind(deferred))
        })
        .add('medium', () => medium(numbers))
        .add('mediumAsync', {
            defer: true,
            fn: deferred => mediumAsync(numbers).then(deferred.resolve.bind(deferred))
        })
        .add('large', () => large(numbers))
        .add('largeAsync', {
            defer: true,
            fn: deferred => largeAsync(numbers).then(deferred.resolve.bind(deferred))
        })
        .add('deferred', () => deferred())
        .add('deferredAsync', {
            defer: true,
            fn: deferred => deferredAsync(10).then(deferred.resolve.bind(deferred))
        })
        .on('cycle', function (event) {
            console.log(String(event.target));
        })
        .on('complete', function () {
            console.log('Fastest is ' + this.filter('fastest').map('name'));
        })
        .run({'async': true});
}

async function criterionTest() {
    bench('empty', empty)
    bench('emptyAsync', emptyAsync)
    bench('trivial', trivial, 100)
    bench('trivialAsync', trivialAsync, 100)
    bench('medium', medium, numbers)
    bench('mediumAsync', mediumAsync, numbers)
    bench('large', large, numbers)
    bench('largeAsync', largeAsync, numbers)
    bench('deferred', deferred)
    bench('deferredAsync', deferredAsync)
}

async function performanceHooksTest() {
    async function runTest() {
        function bench(n, f, ...rest) {
            performance.mark('start')
            for (let i = 0; i < n; i++) {
                f(...rest)
            }
            performance.mark('end')
            let {duration} = performance.measure('', 'start', 'end')
            performance.clearMarks()
            performance.clearMeasures()
            console.log(f.name, 1 / (duration / n), 'ops/s')
        }

        async function benchAsync(n, f, ...rest) {
            performance.mark('start')
            for (let i = 0; i < n; i++) {
                await f(...rest)
            }
            performance.mark('end')
            let {duration} = performance.measure('', 'start', 'end')
            performance.clearMarks()
            performance.clearMeasures()
            console.log(f.name, 1 / (duration / n), 'ops/s')
        }

        bench(10e6, empty)
        await benchAsync(10e6, emptyAsync)
        bench(10e6, trivial, 100)
        await benchAsync(10e6, trivialAsync, 100)
        bench(10_000, medium, numbers)
        await benchAsync(10_000, mediumAsync, numbers)
        bench(1000, large, numbers)
        await benchAsync(1000, largeAsync, numbers)
        bench(1000, deferred)
        await benchAsync(1000, deferredAsync)
    }

    console.log('Running once for warm-up')
    await runTest();

    console.log('\nRunning for real!')
    await runTest();
}

let benchmark = process.argv[2];
if (benchmark === 'tiny') {
    tinyTest()
} else if (benchmark === 'benchmark') {
    benchmarkTest()
} else if (benchmark === 'criterion') {
    criterionTest()
} else if (benchmark === 'performance_hooks') {
    performanceHooksTest()
} else {
    console.error(`Unknown benchmark '${benchmark}', I know of 'tiny', 'benchmark', 'criterion' and 'performance_hooks'!`)
}


// # Test results for a few different runtimes
// A: Node 22 on Mac (late 2013)
// B: Bun 1.1.20 on Mac (last 2013)
// C: Node 22 on Windows (Core Ultra 9)
// D: Bun 1.1.42 on Windows (Core Ultra 9)
// 
// ## Tiny
// 
// ```
// 				A			B			C			D
// empty			14.6M		15.6M		19.5M		45M
// emptyAsync		6.9M		4.3M		13.1M		9.5M
// trivial			14M			18.5M		24M			53.7M
// trivialAsync	4.9M		2.3M		10M			4.5M
// medium			64k			73.5k		260k		141k
// mediumAsync		63k			46k			264k		134k
// large			1.2k		1.3k		2.4k		2.3k
// largeAsync		1.2k		1.3k		2.4k		2.2k
// deferred		198			195			64			62
// deferredAsync	197			194			64			64
// ```
// 
// ## Benchmark
// 
// ```
// 				A			B			C			D
// empty			114M		226M		352M		655M
// emptyAsync		14M			5.3M		38M			9.2M
// trivial			101M		248M		350M		522M
// trivialAsync	14M			4.8M		38M			7.2M
// medium			61.7k		95.8k		250k		266k
// mediumAsync		59.6k		78.6k		230k		238k
// large			1.2k		1.2k		2.4k		2.1k
// largeAsync		1.2k		1.3k		2.4k		2.1k
// deferred		1.7M		4.8M		3.3M		5.5M
// deferredAsync	200			200			68			62
// ```
// 
// ## Criterion
// 
// ```
// 				A			B			C			D
// empty			118M		34M			312M		86.5M
// emptyAsync		14M			25M			41M			11.8M
// trivial			64M			5.4M		161M		28M
// trivialAsync	12.7M		4.9M		38M			8.7M
// medium			63.6k		48.5k		262k		153k
// mediumAsync		63k			47.8k		259k		150k
// large			1.2k		1.3k		2.4k		2.2k
// largeAsync		1.2k		1.3k		2.4k		2.2k
// deferred		200			203			63			63
// deferredAsync	200			203			63			63
// ```
// 
// ## performance_hooks*
// 
// ```
// 				A			B			C			D
// empty			112M		35M			143M		62M
// emptyAsync		10.6M		5.4M		42M			11M
// trivial			65M			22M			164M		47.7M
// trivialAsync	10M			4.9M		38M			8.4M
// medium			62k			72k			243k		163k
// mediumAsync		61k			77.7k		241k		186k
// large			1.2k		1.3k		2.4k		2.2k
// largeAsync		1.2k		1.3k		2.4k		2.2k
// deferred		764k		2.7M		1.9M		1.5M
// deferredAsync	200			206			63			62
// ```
// 
// *) inflated them all with x1000 since duration was not in seconds

// Test results: Macbook Pro 15" late 2013, macOS Big Sur 11.7.10, Node v22.12.0, commit 4cab7dc
//
// $ node /Users/folkol/code/criterion.js/tests/comparison.manual.js tiny
// ┌─────────┬─────────────────┬──────────────────────┬─────────────────────┬────────────────────────────┬───────────────────────────┬──────────┐
// │ (index) │ Task name       │ Latency average (ns) │ Latency median (ns) │ Throughput average (ops/s) │ Throughput median (ops/s) │ Samples  │
// ├─────────┼─────────────────┼──────────────────────┼─────────────────────┼────────────────────────────┼───────────────────────────┼──────────┤
// │ 0       │ 'empty'         │ '69.71 ± 0.12%'      │ '67.00'             │ '14594124 ± 0.00%'         │ '14925373'                │ 14345340 │
// │ 1       │ 'emptyAsync'    │ '167.13 ± 0.99%'     │ '144.00'            │ '6858865 ± 0.01%'          │ '6944444'                 │ 5983458  │
// │ 2       │ 'trivial'       │ '72.74 ± 0.08%'      │ '72.00'             │ '14025395 ± 0.00%'         │ '13888888'                │ 13747951 │
// │ 3       │ 'trivialAsync'  │ '218.85 ± 0.65%'     │ '198.00'            │ '4938557 ± 0.01%'          │ '5050505'                 │ 4570039  │
// │ 4       │ 'medium'        │ '15703.93 ± 0.10%'   │ '15316.00'          │ '64209 ± 0.05%'            │ '65291'                   │ 63679    │
// │ 5       │ 'mediumAsync'   │ '15949.77 ± 0.25%'   │ '15567.00'          │ '63263 ± 0.05%'            │ '64238'                   │ 62697    │
// │ 6       │ 'large'         │ '814707.92 ± 0.24%'  │ '797911.00'         │ '1229 ± 0.20%'             │ '1253'                    │ 1228     │
// │ 7       │ 'largeAsync'    │ '811437.12 ± 0.22%'  │ '797663.00'         │ '1234 ± 0.19%'             │ '1254'                    │ 1233     │
// │ 8       │ 'deferred'      │ '5086512.82 ± 1.19%' │ '5308680.00'        │ '198 ± 1.41%'              │ '188'                     │ 197      │
// │ 9       │ 'deferredAsync' │ '5113327.92 ± 1.18%' │ '5335542.50 ± 5.50' │ '197 ± 1.39%'              │ '187'                     │ 196      │
// └─────────┴─────────────────┴──────────────────────┴─────────────────────┴────────────────────────────┴───────────────────────────┴──────────┘
//
// $ node /Users/folkol/code/criterion.js/tests/comparison.manual.js benchmark
// empty x 112,719,348 ops/sec ±5.17% (75 runs sampled)
// emptyAsync x 14,059,268 ops/sec ±0.84% (80 runs sampled)
// trivial x 101,840,429 ops/sec ±5.07% (70 runs sampled)
// trivialAsync x 14,243,922 ops/sec ±0.90% (80 runs sampled)
// medium x 61,682 ops/sec ±0.29% (89 runs sampled)
// mediumAsync x 59,612 ops/sec ±1.56% (82 runs sampled)
// large x 1,196 ops/sec ±0.23% (91 runs sampled)
// largeAsync x 1,173 ops/sec ±0.25% (84 runs sampled)
// deferred x 1,669,465 ops/sec ±4.06% (81 runs sampled)
// deferredAsync x 200 ops/sec ±0.81% (78 runs sampled)
// Fastest is empty
//
// $ node /Users/folkol/code/criterion.js/tests/comparison.manual.js criterion
// Benchmarking default/empty
// Benchmarking default/empty: Warming up for 3.0000 s
// Benchmarking default/empty: Collecting 100 samples in estimated 5.0000 s (593.3M iterations)
// Benchmarking default/empty: Analyzing
// default/empty           time: [8.4171 ns 8.4398 ns 8.4677 ns]
// Found 8 outliers among 100 measurements (8%)
//   3 (3.00%) low mild
//   3 (3.00%) high mild
//   5 (5.00%) high severe
// slope  [8.4171 ns 8.4677 ns] R^2            [0.9661737 0.9656687]
// mean   [8.4476 ns 8.5188 ns] std. dev.      [102.53 ps 263.87 ps]
// median [8.4062 ns 8.4465 ns] med. abs. dev. [48.502 ps 95.108 ps]
// Benchmarking default/emptyAsync
// Benchmarking default/emptyAsync: Warming up for 3.0000 s
// Benchmarking default/emptyAsync: Collecting 100 samples in estimated 5.0003 s (71.9M iterations)
// Benchmarking default/emptyAsync: Analyzing
// default/emptyAsync      time: [68.807 ns 70.287 ns 72.783 ns]
// Found 2 outliers among 100 measurements (2%)
//   2 (2.00%) high severe
// slope  [68.807 ns 72.783 ns] R^2            [0.2420855 0.2338627]
// mean   [68.605 ns 71.712 ns] std. dev.      [2.0283 ns 13.968 ns]
// median [68.327 ns 69.430 ns] med. abs. dev. [1.8616 ns 3.0661 ns]
// Benchmarking default/trivial
// Benchmarking default/trivial: Warming up for 3.0000 s
// Benchmarking default/trivial: Collecting 100 samples in estimated 5.0001 s (319.8M iterations)
// Benchmarking default/trivial: Analyzing
// default/trivial         time: [15.543 ns 15.588 ns 15.642 ns]
// Found 11 outliers among 100 measurements (11%)
//   7 (7.00%) low mild
//   7 (7.00%) high mild
//   4 (4.00%) high severe
// slope  [15.543 ns 15.642 ns] R^2            [0.9759737 0.9755618]
// mean   [15.589 ns 15.698 ns] std. dev.      [206.14 ps 343.07 ps]
// median [15.526 ns 15.595 ns] med. abs. dev. [107.83 ps 184.78 ps]
// Benchmarking default/trivialAsync
// Benchmarking default/trivialAsync: Warming up for 3.0000 s
// Benchmarking default/trivialAsync: Collecting 100 samples in estimated 5.0004 s (65.0M iterations)
// Benchmarking default/trivialAsync: Analyzing
// default/trivialAsync    time: [76.063 ns 78.315 ns 81.386 ns]
// Found 9 outliers among 100 measurements (9%)
//   2 (2.00%) low mild
//   2 (2.00%) high mild
//   6 (6.00%) high severe
// slope  [76.063 ns 81.386 ns] R^2            [0.2344282 0.2288828]
// mean   [76.208 ns 80.782 ns] std. dev.      [4.1119 ns 18.287 ns]
// median [75.507 ns 76.053 ns] med. abs. dev. [1.0521 ns 2.1000 ns]
// Benchmarking default/medium
// Benchmarking default/medium: Warming up for 3.0000 s
// Benchmarking default/medium: Collecting 100 samples in estimated 5.0636 s (318k iterations)
// Benchmarking default/medium: Analyzing
// default/medium          time: [15.679 µs 15.715 µs 15.755 µs]
// Found 7 outliers among 100 measurements (7%)
//   3 (3.00%) low mild
//   3 (3.00%) high mild
//   4 (4.00%) high severe
// slope  [15.679 µs 15.755 µs] R^2            [0.9859479 0.9857659]
// mean   [15.734 µs 15.849 µs] std. dev.      [191.00 ns 390.00 ns]
// median [15.657 µs 15.698 µs] med. abs. dev. [66.076 ns 144.95 ns]
// Benchmarking default/mediumAsync
// Benchmarking default/mediumAsync: Warming up for 3.0000 s
// Benchmarking default/mediumAsync: Collecting 100 samples in estimated 5.0104 s (308k iterations)
// Benchmarking default/mediumAsync: Analyzing
// default/mediumAsync     time: [15.829 µs 15.856 µs 15.884 µs]
// Found 5 outliers among 100 measurements (5%)
//   1 (1.00%) low mild
//   1 (1.00%) high mild
//   4 (4.00%) high severe
// slope  [15.829 µs 15.884 µs] R^2            [0.9922124 0.9921724]
// mean   [15.875 µs 15.987 µs] std. dev.      [169.49 ns 386.58 ns]
// median [15.809 µs 15.865 µs] med. abs. dev. [71.651 ns 151.06 ns]
// Benchmarking default/large
// Benchmarking default/large: Warming up for 3.0000 s
// Benchmarking default/large: Collecting 100 samples in estimated 8.2865 s (10k iterations)
// Benchmarking default/large: Analyzing
// default/large           time: [816.84 µs 818.45 µs 820.37 µs]
// Found 10 outliers among 100 measurements (10%)
//   3 (3.00%) low mild
//   3 (3.00%) high mild
//   7 (7.00%) high severe
// slope  [816.84 µs 820.37 µs] R^2            [0.9854961 0.9852681]
// mean   [827.32 µs 848.49 µs] std. dev.      [21.732 µs 85.091 µs]
// median [819.23 µs 826.03 µs] med. abs. dev. [8.1170 µs 15.625 µs]
// Benchmarking default/largeAsync
// Benchmarking default/largeAsync: Warming up for 3.0000 s
// Benchmarking default/largeAsync: Collecting 100 samples in estimated 8.3980 s (10k iterations)
// Benchmarking default/largeAsync: Analyzing
// default/largeAsync      time: [816.19 µs 817.71 µs 819.46 µs]
// Found 10 outliers among 100 measurements (10%)
//   4 (4.00%) low mild
//   4 (4.00%) high mild
//   6 (6.00%) high severe
// slope  [816.19 µs 819.46 µs] R^2            [0.9840418 0.9838858]
// mean   [828.57 µs 850.14 µs] std. dev.      [24.220 µs 85.414 µs]
// median [820.19 µs 824.70 µs] med. abs. dev. [7.4522 µs 16.557 µs]
// Benchmarking default/deferred
// Benchmarking default/deferred: Warming up for 3.0000 s
// Warning: Unable to complete 100 samples in 5. You may wish to increase target time to ~26 s.
// Benchmarking default/deferred: Collecting 100 samples in estimated 25.736 s (5050 iterations)
// Benchmarking default/deferred: Analyzing
// default/deferred        time: [4.9611 ms 4.9923 ms 5.0196 ms]
// Found 12 outliers among 100 measurements (12%)
//   3 (3.00%) low severe
//   7 (7.00%) low mild
//   7 (7.00%) high mild
// slope  [4.9611 ms 5.0196 ms] R^2            [0.9401271 0.9411625]
// mean   [5.0014 ms 5.0519 ms] std. dev.      [99.517 µs 157.46 µs]
// median [5.0062 ms 5.0474 ms] med. abs. dev. [60.285 µs 106.74 µs]
// Benchmarking default/deferredAsync
// Benchmarking default/deferredAsync: Warming up for 3.0000 s
// Warning: Unable to complete 100 samples in 5. You may wish to increase target time to ~25 s.
// Benchmarking default/deferredAsync: Collecting 100 samples in estimated 24.650 s (5050 iterations)
// Benchmarking default/deferredAsync: Analyzing
// default/deferredAsync   time: [4.9697 ms 4.9859 ms 5.0022 ms]
// Found 8 outliers among 100 measurements (8%)
//   1 (1.00%) low severe
//   2 (2.00%) low mild
//   2 (2.00%) high mild
//   1 (1.00%) high severe
// slope  [4.9697 ms 5.0022 ms] R^2            [0.9719734 0.9719682]
// mean   [4.9558 ms 5.0099 ms] std. dev.      [84.616 µs 199.76 µs]
// median [4.9807 ms 5.0168 ms] med. abs. dev. [53.207 µs 105.38 µs]
//
// $ node /Users/folkol/code/criterion.js/tests/comparison.manual.js performance_hooks
// Running once for warm-up
// empty 114146.42564222745 ops/s
// emptyAsync 13449.361929117407 ops/s
// trivial 64071.85848581888 ops/s
// trivialAsync 12144.573171913804 ops/s
// medium 45.489224992295156 ops/s
// mediumAsync 39.39360649408964 ops/s
// large 1.2102681302447236 ops/s
// largeAsync 1.2227434049145747 ops/s
// deferred 863.9577559216478 ops/s
// deferredAsync 0.19601622704497484 ops/s
// 
// Running for real!
// empty 112280.94759056662 ops/s
// emptyAsync 10669.456089266645 ops/s
// trivial 65370.72943483954 ops/s
// trivialAsync 10105.429603468383 ops/s
// medium 62.67012746151314 ops/s
// mediumAsync 61.72523564411118 ops/s
// large 1.2277254281998444 ops/s
// largeAsync 1.2201991404531676 ops/s
// deferred 764.7516774831697 ops/s
// deferredAsync 0.2010295675829897 ops/s

// Test results: Macbook Pro 15" late 2013, macOS Big Sur 11.7.10, Bun v1.1.20 (which seems to be the last one supported on my computer), commit 4cab7dc
//
// $ bun tests/comparison.manual.js tiny
// ┌───┬───────────────┬──────────────────────┬─────────────────────┬────────────────────────────┬───────────────────────────┬──────────┐
// │   │ Task name     │ Latency average (ns) │ Latency median (ns) │ Throughput average (ops/s) │ Throughput median (ops/s) │ Samples  │
// ├───┼───────────────┼──────────────────────┼─────────────────────┼────────────────────────────┼───────────────────────────┼──────────┤
// │ 0 │ empty         │ 66.21 ± 0.09%        │ 64.00               │ 15599656 ± 0.01%           │ 15625000                  │ 15104411 │
// │ 1 │ emptyAsync    │ 268.04 ± 0.30%       │ 233.00              │ 4137183 ± 0.01%            │ 4291846                   │ 3730757  │
// │ 2 │ trivial       │ 54.35 ± 0.10%        │ 54.00               │ 18898930 ± 0.00%           │ 18518518                  │ 18399517 │
// │ 3 │ trivialAsync  │ 538.83 ± 0.28%       │ 441.00              │ 2123931 ± 0.03%            │ 2267574                   │ 1855872  │
// │ 4 │ medium        │ 14510.37 ± 0.16%     │ 13601.00            │ 70743 ± 0.09%              │ 73524                     │ 68917    │
// │ 5 │ mediumAsync   │ 22583.18 ± 0.13%     │ 21512.00            │ 44755 ± 0.08%              │ 46486                     │ 44281    │
// │ 6 │ large         │ 771443.93 ± 0.34%    │ 752858.00           │ 1301 ± 0.31%               │ 1328                      │ 1297     │
// │ 7 │ largeAsync    │ 766902.43 ± 0.32%    │ 750530.00 ± 5.00    │ 1308 ± 0.29%               │ 1332                      │ 1304     │
// │ 8 │ deferred      │ 4899546.31 ± 1.08%   │ 5139436.00          │ 205 ± 1.16%                │ 195                       │ 205      │
// │ 9 │ deferredAsync │ 4955502.73 ± 1.11%   │ 5162562.00 ± 616.00 │ 203 ± 1.20%                │ 194                       │ 202      │
// └───┴───────────────┴──────────────────────┴─────────────────────┴────────────────────────────┴───────────────────────────┴──────────┘
//
// $ bun tests/comparison.manual.js benchmark
// empty x 266,216,781 ops/sec ±88.71% (23 runs sampled)
// emptyAsync x 5,398,017 ops/sec ±0.48% (83 runs sampled)
// trivial x 248,212,737 ops/sec ±88.58% (21 runs sampled)
// trivialAsync x 4,802,098 ops/sec ±0.34% (83 runs sampled)
// medium x 95,880 ops/sec ±0.24% (92 runs sampled)
// mediumAsync x 78,682 ops/sec ±0.30% (85 runs sampled)
// large x 1,244 ops/sec ±0.95% (91 runs sampled)
// largeAsync x 1,250 ops/sec ±0.24% (83 runs sampled)
// deferred x 4,840,527 ops/sec ±2.82% (74 runs sampled)
// deferredAsync x 200 ops/sec ±1.02% (81 runs sampled)
// Fastest is empty
//
// $ bun tests/comparison.manual.js criterion
// Benchmarking default/empty
// Benchmarking default/empty: Warming up for 3.0000 s
// Benchmarking default/empty: Collecting 100 samples in estimated 5.0001 s (147.2M iterations)
// Benchmarking default/empty: Analyzing
// default/empty           time: [29.139 ns 29.317 ns 29.530 ns]
// Found 1 outliers among 100 measurements (1%)
//   1 (1.00%) low mild
//   1 (1.00%) high mild
// slope  [29.139 ns 29.530 ns] R^2            [0.8364547 0.8347571]
// mean   [30.318 ns 31.137 ns] std. dev.      [1.7996 ns 2.3629 ns]
// median [29.717 ns 30.372 ns] med. abs. dev. [1.1673 ns 2.2328 ns]
// Benchmarking default/emptyAsync
// Benchmarking default/emptyAsync: Warming up for 3.0000 s
// Benchmarking default/emptyAsync: Collecting 100 samples in estimated 5.0009 s (26.9M iterations)
// Benchmarking default/emptyAsync: Analyzing
// default/emptyAsync      time: [181.89 ns 182.51 ns 183.15 ns]
// Found 4 outliers among 100 measurements (4%)
//   1 (1.00%) low mild
//   1 (1.00%) high mild
//   1 (1.00%) high severe
// slope  [181.89 ns 183.15 ns] R^2            [0.9740869 0.9740291]
// mean   [181.79 ns 183.42 ns] std. dev.      [2.7864 ns 5.7439 ns]
// median [181.24 ns 182.51 ns] med. abs. dev. [1.8067 ns 3.4055 ns]
// Benchmarking default/trivial
// Benchmarking default/trivial: Warming up for 3.0000 s
// Benchmarking default/trivial: Collecting 100 samples in estimated 5.0002 s (125.0M iterations)
// Benchmarking default/trivial: Analyzing
// default/trivial         time: [39.092 ns 39.242 ns 39.412 ns]
// Found 7 outliers among 100 measurements (7%)
//   6 (6.00%) low mild
//   6 (6.00%) high mild
//   1 (1.00%) high severe
// slope  [39.092 ns 39.412 ns] R^2            [0.9532369 0.9526324]
// mean   [39.550 ns 40.090 ns] std. dev.      [906.41 ps 1.8996 ns]
// median [39.296 ns 39.651 ns] med. abs. dev. [676.42 ps 1.1154 ns]
// Benchmarking default/trivialAsync
// Benchmarking default/trivialAsync: Warming up for 3.0000 s
// Benchmarking default/trivialAsync: Collecting 100 samples in estimated 5.0000 s (24.3M iterations)
// Benchmarking default/trivialAsync: Analyzing
// default/trivialAsync    time: [203.41 ns 203.92 ns 204.47 ns]
// Found 9 outliers among 100 measurements (9%)
//   5 (5.00%) low mild
//   5 (5.00%) high mild
//   3 (3.00%) high severe
// slope  [203.41 ns 204.47 ns] R^2            [0.9791022 0.9789805]
// mean   [204.40 ns 207.50 ns] std. dev.      [3.7249 ns 12.093 ns]
// median [203.24 ns 204.67 ns] med. abs. dev. [1.9942 ns 3.5670 ns]
// Benchmarking default/medium
// Benchmarking default/medium: Warming up for 3.0000 s
// Benchmarking default/medium: Collecting 100 samples in estimated 5.0179 s (242k iterations)
// Benchmarking default/medium: Analyzing
// default/medium          time: [20.570 µs 20.610 µs 20.655 µs]
// Found 7 outliers among 100 measurements (7%)
//   2 (2.00%) low mild
//   2 (2.00%) high mild
//   5 (5.00%) high severe
// slope  [20.570 µs 20.655 µs] R^2            [0.9879847 0.9878668]
// mean   [20.656 µs 20.834 µs] std. dev.      [290.86 ns 597.10 ns]
// median [20.557 µs 20.632 µs] med. abs. dev. [123.36 ns 244.56 ns]
// Benchmarking default/mediumAsync
// Benchmarking default/mediumAsync: Warming up for 3.0000 s
// Benchmarking default/mediumAsync: Collecting 100 samples in estimated 5.0834 s (242k iterations)
// Benchmarking default/mediumAsync: Analyzing
// default/mediumAsync     time: [20.853 µs 20.910 µs 20.977 µs]
// Found 10 outliers among 100 measurements (10%)
//   6 (6.00%) low mild
//   6 (6.00%) high mild
//   4 (4.00%) high severe
// slope  [20.853 µs 20.977 µs] R^2            [0.9798549 0.9795015]
// mean   [20.917 µs 21.064 µs] std. dev.      [243.89 ns 497.49 ns]
// median [20.833 µs 20.930 µs] med. abs. dev. [132.80 ns 234.57 ns]
// Benchmarking default/large
// Benchmarking default/large: Warming up for 3.0000 s
// Benchmarking default/large: Collecting 100 samples in estimated 7.8488 s (10k iterations)
// Benchmarking default/large: Analyzing
// default/large           time: [778.88 µs 780.50 µs 782.23 µs]
// Found 8 outliers among 100 measurements (8%)
//   1 (1.00%) low mild
//   1 (1.00%) high mild
//   7 (7.00%) high severe
// slope  [778.88 µs 782.23 µs] R^2            [0.9861296 0.9860461]
// mean   [787.83 µs 806.69 µs] std. dev.      [19.359 µs 75.817 µs]
// median [780.91 µs 786.40 µs] med. abs. dev. [8.3061 µs 14.355 µs]
// Benchmarking default/largeAsync
// Benchmarking default/largeAsync: Warming up for 3.0000 s
// Benchmarking default/largeAsync: Collecting 100 samples in estimated 7.8212 s (10k iterations)
// Benchmarking default/largeAsync: Analyzing
// default/largeAsync      time: [770.82 µs 772.37 µs 774.05 µs]
// Found 10 outliers among 100 measurements (10%)
//   3 (3.00%) low mild
//   3 (3.00%) high mild
//   7 (7.00%) high severe
// slope  [770.82 µs 774.05 µs] R^2            [0.9880144 0.9879213]
// mean   [780.31 µs 799.48 µs] std. dev.      [19.399 µs 77.313 µs]
// median [773.78 µs 779.35 µs] med. abs. dev. [7.8300 µs 13.431 µs]
// Benchmarking default/deferred
// Benchmarking default/deferred: Warming up for 3.0000 s
// Warning: Unable to complete 100 samples in 5. You may wish to increase target time to ~25 s.
// Benchmarking default/deferred: Collecting 100 samples in estimated 24.635 s (5050 iterations)
// Benchmarking default/deferred: Analyzing
// default/deferred        time: [4.8898 ms 4.9038 ms 4.9176 ms]
// Found 3 outliers among 100 measurements (3%)
//   2 (2.00%) low severe
//   1 (1.00%) low mild
//   1 (1.00%) high mild
// slope  [4.8898 ms 4.9176 ms] R^2            [0.9812168 0.9812300]
// mean   [4.8608 ms 4.9017 ms] std. dev.      [66.959 µs 144.45 µs]
// median [4.8725 ms 4.9039 ms] med. abs. dev. [60.356 µs 89.224 µs]
// Benchmarking default/deferredAsync
// Benchmarking default/deferredAsync: Warming up for 3.0000 s
// Warning: Unable to complete 100 samples in 5. You may wish to increase target time to ~25 s.
// Benchmarking default/deferredAsync: Collecting 100 samples in estimated 24.661 s (5050 iterations)
// Benchmarking default/deferredAsync: Analyzing
// default/deferredAsync   time: [4.8973 ms 4.9127 ms 4.9285 ms]
// Found 2 outliers among 100 measurements (2%)
//   1 (1.00%) low severe
// slope  [4.8973 ms 4.9285 ms] R^2            [0.9788286 0.9787508]
// mean   [4.8954 ms 4.9298 ms] std. dev.      [63.085 µs 117.17 µs]
// median [4.9059 ms 4.9373 ms] med. abs. dev. [54.045 µs 84.601 µs]
//
// $ bun tests/comparison.manual.js performance_hooks
// Running once for warm-up
// empty 33559.84292020195 ops/s
// emptyAsync 5585.427489205078 ops/s
// trivial 23034.94557420539 ops/s
// trivialAsync 4975.869441529392 ops/s
// medium 92.75442071511196 ops/s
// mediumAsync 77.98582758876078 ops/s
// large 1.2854163950555046 ops/s
// largeAsync 1.2874071831239111 ops/s
// deferred 1283.3724975843147 ops/s
// deferredAsync 0.20330785829620376 ops/s
// 
// Running for real!
// empty 35130.336587513826 ops/s
// emptyAsync 5439.545625615457 ops/s
// trivial 22092.605690152912 ops/s
// trivialAsync 4947.38927934999 ops/s
// medium 72.47515511821143 ops/s
// mediumAsync 77.6837683339518 ops/s
// large 1.2876044028921803 ops/s
// largeAsync 1.3041075170607765 ops/s
// deferred 2660.713763072177 ops/s
// deferredAsync 0.2061648737955901 ops/s

// Test results: Windows, pc, ..., commit 4cab7dc
// Intel Core Ultra 9 285K, 32GB, Windows 10 19045.5247, Node 22.12.0, commit 4cab7dc

// C:\Users\folkol\Downloads\criterion.js>node tests/comparison.manual.js tiny
// ┌─────────┬─────────────────┬───────────────────────┬──────────────────────────┬────────────────────────────┬───────────────────────────┬──────────┐
// │ (index) │ Task name       │ Latency average (ns)  │ Latency median (ns)      │ Throughput average (ops/s) │ Throughput median (ops/s) │ Samples  │
// ├─────────┼─────────────────┼───────────────────────┼──────────────────────────┼────────────────────────────┼───────────────────────────┼──────────┤
// │ 0       │ 'empty'         │ '39.06 ± 0.10%'       │ '100.00'                 │ '19582737 ± 0.02%'         │ '25600580'                │ 25600580 │
// │ 1       │ 'emptyAsync'    │ '58.24 ± 0.24%'       │ '100.00'                 │ '13111374 ± 0.01%'         │ '10000000'                │ 17169600 │
// │ 2       │ 'trivial'       │ '32.50 ± 0.08%'       │ '0.00'                   │ '24070856 ± 0.01%'         │ '30765677'                │ 30765677 │
// │ 3       │ 'trivialAsync'  │ '88.02 ± 0.34%'       │ '100.00'                 │ '10138689 ± 0.01%'         │ '10000000'                │ 11360822 │
// │ 4       │ 'medium'        │ '3945.29 ± 0.36%'     │ '3800.00'                │ '260390 ± 0.03%'           │ '263158'                  │ 253467   │
// │ 5       │ 'mediumAsync'   │ '3853.82 ± 0.41%'     │ '3800.00'                │ '264183 ± 0.02%'           │ '263158'                  │ 259483   │
// │ 6       │ 'large'         │ '431319.66 ± 1.52%'   │ '419700.00'              │ '2394 ± 0.38%'             │ '2383'                    │ 2319     │
// │ 7       │ 'largeAsync'    │ '430273.12 ± 1.50%'   │ '420000.00'              │ '2374 ± 0.28%'             │ '2381'                    │ 2325     │
// │ 8       │ 'deferred'      │ '15665226.56 ± 0.84%' │ '15779600.00 ± 23200.00' │ '64 ± 0.84%'               │ '63'                      │ 64       │
// │ 9       │ 'deferredAsync' │ '15597361.54 ± 1.00%' │ '15652300.00'            │ '64 ± 1.03%'               │ '64'                      │ 65       │
// └─────────┴─────────────────┴───────────────────────┴──────────────────────────┴────────────────────────────┴───────────────────────────┴──────────┘
// 
// C:\Users\folkol\Downloads\criterion.js>node tests/comparison.manual.js benchmark
// empty x 352,104,054 ops/sec ±5.79% (74 runs sampled)
// emptyAsync x 38,645,183 ops/sec ±2.74% (76 runs sampled)
// trivial x 350,562,847 ops/sec ±5.07% (76 runs sampled)
// trivialAsync x 38,071,604 ops/sec ±1.96% (77 runs sampled)
// medium x 250,057 ops/sec ±2.52% (93 runs sampled)
// mediumAsync x 229,035 ops/sec ±1.75% (73 runs sampled)
// large x 2,359 ops/sec ±1.10% (91 runs sampled)
// largeAsync x 2,352 ops/sec ±1.04% (83 runs sampled)
// deferred x 3,239,023 ops/sec ±4.50% (77 runs sampled)
// deferredAsync x 68.03 ops/sec ±1.26% (69 runs sampled)
// Fastest is trivial,empty
// 
// C:\Users\folkol\Downloads\criterion.js>node tests/comparison.manual.js criterion
// Benchmarking default/empty
// Benchmarking default/empty: Warming up for 3.0000 s
// Benchmarking default/empty: Collecting 100 samples in estimated 5.0000 s (1.56540405B iterations)
// Benchmarking default/empty: Analyzing
// default/empty           time: [3.1864 ns 3.2018 ns 3.2200 ns]
// Found 12 outliers among 100 measurements (12%)
//   6 (6.00%) low mild
//   6 (6.00%) high mild
//   6 (6.00%) high severe
// slope  [3.1864 ns 3.2200 ns] R^2            [0.9411250 0.9399672]
// mean   [3.1882 ns 3.2270 ns] std. dev.      [54.003 ps 140.81 ps]
// median [3.1623 ns 3.1839 ns] med. abs. dev. [17.124 ps 44.044 ps]
// Benchmarking default/emptyAsync
// Benchmarking default/emptyAsync: Warming up for 3.0000 s
// Benchmarking default/emptyAsync: Collecting 100 samples in estimated 5.0001 s (207.0M iterations)
// Benchmarking default/emptyAsync: Analyzing
// default/emptyAsync      time: [24.035 ns 24.195 ns 24.375 ns]
// Found 5 outliers among 100 measurements (5%)
//   2 (2.00%) low mild
//   2 (2.00%) high mild
//   2 (2.00%) high severe
// slope  [24.035 ns 24.375 ns] R^2            [0.8997976 0.8984166]
// mean   [23.953 ns 24.192 ns] std. dev.      [448.07 ps 772.13 ps]
// median [23.987 ns 24.169 ns] med. abs. dev. [313.31 ps 564.31 ps]
// Benchmarking default/trivial
// Benchmarking default/trivial: Warming up for 3.0000 s
// Benchmarking default/trivial: Collecting 100 samples in estimated 5.0000 s (802.4M iterations)
// Benchmarking default/trivial: Analyzing
// default/trivial         time: [6.1903 ns 6.2030 ns 6.2179 ns]
// Found 21 outliers among 100 measurements (21%)
//   10 (10.00%) low severe
//   4 (4.00%) low mild
//   4 (4.00%) high mild
//   5 (5.00%) high severe
// slope  [6.1903 ns 6.2179 ns] R^2            [0.9798098 0.9796094]
// mean   [6.1802 ns 6.2237 ns] std. dev.      [61.187 ps 162.39 ps]
// median [6.1960 ns 6.2025 ns] med. abs. dev. [14.559 ps 25.790 ps]
// Benchmarking default/trivialAsync
// Benchmarking default/trivialAsync: Warming up for 3.0000 s
// Benchmarking default/trivialAsync: Collecting 100 samples in estimated 5.0001 s (189.0M iterations)
// Benchmarking default/trivialAsync: Analyzing
// default/trivialAsync    time: [26.495 ns 26.551 ns 26.609 ns]
// Found 7 outliers among 100 measurements (7%)
//   1 (1.00%) low severe
//   1 (1.00%) low mild
//   1 (1.00%) high mild
// slope  [26.495 ns 26.609 ns] R^2            [0.9882697 0.9882041]
// mean   [26.399 ns 26.552 ns] std. dev.      [289.30 ps 495.25 ps]
// median [26.457 ns 26.595 ns] med. abs. dev. [206.68 ps 338.03 ps]
// Benchmarking default/medium
// Benchmarking default/medium: Warming up for 3.0000 s
// Benchmarking default/medium: Collecting 100 samples in estimated 5.0161 s (1.3M iterations)
// Benchmarking default/medium: Analyzing
// default/medium          time: [3.8030 µs 3.8124 µs 3.8261 µs]
// Found 9 outliers among 100 measurements (9%)
//   4 (4.00%) low mild
//   4 (4.00%) high mild
//   5 (5.00%) high severe
// slope  [3.8030 µs 3.8261 µs] R^2            [0.9817230 0.9808639]
// mean   [3.8133 µs 3.8338 µs] std. dev.      [34.552 ns 67.174 ns]
// median [3.8024 µs 3.8128 µs] med. abs. dev. [16.876 ns 29.971 ns]
// Benchmarking default/mediumAsync
// Benchmarking default/mediumAsync: Warming up for 3.0000 s
// Benchmarking default/mediumAsync: Collecting 100 samples in estimated 5.0065 s (1.3M iterations)
// Benchmarking default/mediumAsync: Analyzing
// default/mediumAsync     time: [3.8488 µs 3.8579 µs 3.8707 µs]
// Found 11 outliers among 100 measurements (11%)
//   4 (4.00%) low mild
//   4 (4.00%) high mild
//   7 (7.00%) high severe
// slope  [3.8488 µs 3.8707 µs] R^2            [0.9824447 0.9816983]
// mean   [3.8567 µs 3.8936 µs] std. dev.      [38.767 ns 148.14 ns]
// median [3.8456 µs 3.8556 µs] med. abs. dev. [13.343 ns 21.854 ns]
// Benchmarking default/large
// Benchmarking default/large: Warming up for 3.0000 s
// Benchmarking default/large: Collecting 100 samples in estimated 6.3822 s (15k iterations)
// Benchmarking default/large: Analyzing
// default/large           time: [422.53 µs 423.03 µs 423.78 µs]
// Found 13 outliers among 100 measurements (13%)
//   5 (5.00%) low mild
//   5 (5.00%) high mild
//   8 (8.00%) high severe
// slope  [422.53 µs 423.78 µs] R^2            [0.9958030 0.9955526]
// mean   [425.24 µs 431.73 µs] std. dev.      [5.5685 µs 26.501 µs]
// median [422.97 µs 424.28 µs] med. abs. dev. [1.3847 µs 2.9624 µs]
// Benchmarking default/largeAsync
// Benchmarking default/largeAsync: Warming up for 3.0000 s
// Benchmarking default/largeAsync: Collecting 100 samples in estimated 6.4073 s (15k iterations)
// Benchmarking default/largeAsync: Analyzing
// default/largeAsync      time: [422.56 µs 422.81 µs 423.13 µs]
// Found 11 outliers among 100 measurements (11%)
//   4 (4.00%) low mild
//   4 (4.00%) high mild
//   7 (7.00%) high severe
// slope  [422.56 µs 423.13 µs] R^2            [0.9979892 0.9979597]
// mean   [425.26 µs 431.71 µs] std. dev.      [5.6029 µs 26.511 µs]
// median [422.94 µs 424.29 µs] med. abs. dev. [1.3231 µs 3.0430 µs]
// Benchmarking default/deferred
// Benchmarking default/deferred: Warming up for 3.0000 s
// Warning: Unable to complete 100 samples in 5. You may wish to increase target time to ~79 s.
// Benchmarking default/deferred: Collecting 100 samples in estimated 78.882 s (5050 iterations)
// Benchmarking default/deferred: Analyzing
// default/deferred        time: [15.671 ms 15.694 ms 15.717 ms]
// Found 4 outliers among 100 measurements (4%)
//   1 (1.00%) low severe
// slope  [15.671 ms 15.717 ms] R^2            [0.9941949 0.9941813]
// mean   [15.330 ms 15.708 ms] std. dev.      [109.16 µs 1.9744 ms]
// median [15.662 ms 15.720 ms] med. abs. dev. [94.560 µs 146.52 µs]
// Benchmarking default/deferredAsync
// Benchmarking default/deferredAsync: Warming up for 3.0000 s
// Warning: Unable to complete 100 samples in 5. You may wish to increase target time to ~80 s.
// Benchmarking default/deferredAsync: Collecting 100 samples in estimated 79.291 s (5050 iterations)
// Benchmarking default/deferredAsync: Analyzing
// default/deferredAsync   time: [15.747 ms 15.779 ms 15.808 ms]
// Found 2 outliers among 100 measurements (2%)
//   1 (1.00%) low severe
// slope  [15.747 ms 15.808 ms] R^2            [0.9914048 0.9914940]
// mean   [15.431 ms 15.729 ms] std. dev.      [119.97 µs 1.5021 ms]
// median [15.665 ms 15.744 ms] med. abs. dev. [113.60 µs 173.19 µs]
// 
// C:\Users\folkol\Downloads\criterion.js>node tests/comparison.manual.js performance_hooks
// Running once for warm-up
// empty 335302.6777271843 ops/s
// emptyAsync 41715.83921213797 ops/s
// trivial 160791.09217349358 ops/s
// trivialAsync 35489.787458760875 ops/s
// medium 155.99212551750404 ops/s
// mediumAsync 127.4377243700435 ops/s
// large 2.3529771631801433 ops/s
// largeAsync 2.3957598883192572 ops/s
// deferred 1850.4811250929924 ops/s
// deferredAsync 0.06367289937756429 ops/s
// 
// Running for real!
// empty 143185.6516522177 ops/s
// emptyAsync 41879.0457775658 ops/s
// trivial 164469.89707473764 ops/s
// trivialAsync 38266.965659225 ops/s
// medium 242.96908218428516 ops/s
// mediumAsync 241.8929575284372 ops/s
// large 2.3701063229696557 ops/s
// largeAsync 2.3600073160226747 ops/s
// deferred 1863.585538578121 ops/s
// deferredAsync 0.06373915693364428 ops/s

// Intel Core Ultra 9 285K, 32GB, Windows 11 22631.4602 Bun 1.1.42, commit 4cab7dc
// (Bun crashed a lot, tried different versions and different profiles...)
//
// C:\Users\folkol\Downloads\criterion.js>..\bun tests/comparison.manual.js tiny
// ┌───┬───────────────┬──────────────────────┬───────────────────────┬────────────────────────────┬───────────────────────────┬──────────┐
// │   │ Task name     │ Latency average (ns) │ Latency median (ns)   │ Throughput average (ops/s) │ Throughput median (ops/s) │ Samples  │
// ├───┼───────────────┼──────────────────────┼───────────────────────┼────────────────────────────┼───────────────────────────┼──────────┤
// │ 0 │ empty         │ 18.83 ± 0.07%        │ 0.00                  │ 45130137 ± 0.01%           │ 53104759                  │ 53104759 │
// │ 1 │ emptyAsync    │ 122.28 ± 0.29%       │ 100.00                │ 9451770 ± 0.01%            │ 10000000                  │ 8178058  │
// │ 2 │ trivial       │ 16.12 ± 0.15%        │ 0.00                  │ 53715905 ± 0.01%           │ 62024096                  │ 62024102 │
// │ 3 │ trivialAsync  │ 265.58 ± 16.57%      │ 200.00                │ 4530605 ± 0.02%            │ 5000000                   │ 3765338  │
// │ 4 │ medium        │ 7065.62 ± 0.02%      │ 7000.00               │ 141675 ± 0.02%             │ 142857                    │ 141531   │
// │ 5 │ mediumAsync   │ 7549.07 ± 0.15%      │ 7400.00               │ 133786 ± 0.03%             │ 135135                    │ 132467   │
// │ 6 │ large         │ 436316.27 ± 0.94%    │ 456800.00             │ 2323 ± 0.42%               │ 2189                      │ 2292     │
// │ 7 │ largeAsync    │ 466791.88 ± 1.21%    │ 458900.00             │ 2168 ± 0.22%               │ 2179                      │ 2143     │
// │ 8 │ deferred      │ 16192346.87 ± 3.24%  │ 15971450.00 ± 3750.00 │ 62 ± 1.79%                 │ 63                        │ 64       │
// │ 9 │ deferredAsync │ 15757409.37 ± 1.18%  │ 15934700.00 ± 3500.00 │ 64 ± 1.58%                 │ 63                        │ 64       │
// └───┴───────────────┴──────────────────────┴───────────────────────┴────────────────────────────┴───────────────────────────┴──────────┘
// 
// C:\Users\folkol\Downloads\criterion.js>..\bun tests/comparison.manual.js benchmark
// empty x 655,550,935 ops/sec ±49.04% (28 runs sampled)
// emptyAsync x 9,118,590 ops/sec ±3.43% (68 runs sampled)
// trivial x 521,607,356 ops/sec ±45.05% (27 runs sampled)
// trivialAsync x 7,160,564 ops/sec ±2.16% (66 runs sampled)
// medium x 266,017 ops/sec ±0.75% (95 runs sampled)
// mediumAsync x 237,711 ops/sec ±1.92% (66 runs sampled)
// large x 2,130 ops/sec ±0.78% (91 runs sampled)
// largeAsync x 2,087 ops/sec ±1.93% (72 runs sampled)
// deferred x 5,516,487 ops/sec ±4.46% (74 runs sampled)
// deferredAsync x 61.53 ops/sec ±3.03% (62 runs sampled)
// Fastest is empty
// 
// C:\Users\folkol\Downloads\criterion.js>..\bun tests/comparison.manual.js criterion
// Benchmarking default/empty
// Benchmarking default/empty: Warming up for 3.0000 s
// Benchmarking default/empty: Collecting 100 samples in estimated 5.0000 s (440.1M iterations)
// Benchmarking default/empty: Analyzing
// default/empty           time: [11.322 ns 11.549 ns 11.778 ns]
// Found 8 outliers among 100 measurements (8%)
//   5 (5.00%) low mild
//   5 (5.00%) high mild
//   3 (3.00%) high severe
// slope  [11.322 ns 11.778 ns] R^2            [0.5136336 0.5135213]
// mean   [11.281 ns 13.619 ns] std. dev.      [1.1483 ns 11.080 ns]
// median [10.721 ns 11.438 ns] med. abs. dev. [551.13 ps 1.2693 ns]
// Benchmarking default/emptyAsync
// Benchmarking default/emptyAsync: Warming up for 3.0000 s
// Benchmarking default/emptyAsync: Collecting 100 samples in estimated 5.0004 s (59.7M iterations)
// Benchmarking default/emptyAsync: Analyzing
// default/emptyAsync      time: [83.040 ns 84.715 ns 86.435 ns]
// Found 4 outliers among 100 measurements (4%)
//   1 (1.00%) low mild
//   1 (1.00%) high mild
//   3 (3.00%) high severe
// slope  [83.040 ns 86.435 ns] R^2            [0.5262049 0.5254767]
// mean   [83.621 ns 102.43 ns] std. dev.      [8.9536 ns 87.890 ns]
// median [80.294 ns 85.145 ns] med. abs. dev. [6.5076 ns 11.187 ns]
// Benchmarking default/trivial
// Benchmarking default/trivial: Warming up for 3.0000 s
// Benchmarking default/trivial: Collecting 100 samples in estimated 5.0002 s (139.1M iterations)
// Benchmarking default/trivial: Analyzing
// default/trivial         time: [35.129 ns 35.629 ns 36.138 ns]
// Found 7 outliers among 100 measurements (7%)
//   5 (5.00%) low mild
//   5 (5.00%) high mild
//   2 (2.00%) high severe
// slope  [35.129 ns 36.138 ns] R^2            [0.5664423 0.5660708]
// mean   [35.229 ns 44.513 ns] std. dev.      [2.6992 ns 45.375 ns]
// median [34.104 ns 35.107 ns] med. abs. dev. [1.3512 ns 3.1080 ns]
// Benchmarking default/trivialAsync
// Benchmarking default/trivialAsync: Warming up for 3.0000 s
// Benchmarking default/trivialAsync: Collecting 100 samples in estimated 5.0002 s (44.3M iterations)
// Benchmarking default/trivialAsync: Analyzing
// default/trivialAsync    time: [112.61 ns 114.73 ns 116.91 ns]
// Found 4 outliers among 100 measurements (4%)
//   1 (1.00%) low mild
//   1 (1.00%) high mild
//   3 (3.00%) high severe
// slope  [112.61 ns 116.91 ns] R^2            [0.5155389 0.5149496]
// mean   [112.76 ns 127.94 ns] std. dev.      [12.590 ns 63.414 ns]
// median [107.89 ns 114.24 ns] med. abs. dev. [8.1953 ns 14.849 ns]
// Benchmarking default/medium
// Benchmarking default/medium: Warming up for 3.0000 s
// Benchmarking default/medium: Collecting 100 samples in estimated 5.0324 s (768k iterations)
// Benchmarking default/medium: Analyzing
// default/medium          time: [6.4760 µs 6.4962 µs 6.5209 µs]
// Found 4 outliers among 100 measurements (4%)
//   4 (4.00%) high severe
// slope  [6.4760 µs 6.5209 µs] R^2            [0.9365141 0.9358931]
// mean   [6.5005 µs 8.4039 µs] std. dev.      [87.521 ns 9.7354 µs]
// median [6.5078 µs 6.5277 µs] med. abs. dev. [28.983 ns 75.621 ns]
// Benchmarking default/mediumAsync
// Benchmarking default/mediumAsync: Warming up for 3.0000 s
// Benchmarking default/mediumAsync: Collecting 100 samples in estimated 5.0232 s (752k iterations)
// Benchmarking default/mediumAsync: Analyzing
// default/mediumAsync     time: [6.5831 µs 6.6547 µs 6.7440 µs]
// Found 7 outliers among 100 measurements (7%)
//   7 (7.00%) high severe
// slope  [6.5831 µs 6.7440 µs] R^2            [0.8349939 0.8307946]
// mean   [6.5979 µs 6.7524 µs] std. dev.      [139.02 ns 605.10 ns]
// median [6.5565 µs 6.6119 µs] med. abs. dev. [65.605 ns 97.282 ns]
// 
// Crashed again...
// 
// Commented out everything except the deferred ones:
// 
// C:\Users\folkol\Downloads\criterion.js>..\bun tests/comparison.manual.js criterion
// Benchmarking default/deferred
// Benchmarking default/deferred: Warming up for 3.0000 s
// Warning: Unable to complete 100 samples in 5. You may wish to increase target time to ~81 s.
// Benchmarking default/deferred: Collecting 100 samples in estimated 80.172 s (5050 iterations)
// Benchmarking default/deferred: Analyzing
// default/deferred        time: [15.928 ms 15.957 ms 15.987 ms]
// Found 9 outliers among 100 measurements (9%)
//   7 (7.00%) low mild
//   7 (7.00%) high mild
//   2 (2.00%) high severe
// slope  [15.928 ms 15.987 ms] R^2            [0.9899006 0.9898848]
// mean   [15.950 ms 16.072 ms] std. dev.      [162.08 µs 472.69 µs]
// median [15.890 ms 15.974 ms] med. abs. dev. [94.112 µs 167.17 µs]
// Benchmarking default/deferredAsync
// Benchmarking default/deferredAsync: Warming up for 3.0000 s
// Warning: Unable to complete 100 samples in 5. You may wish to increase target time to ~81 s.
// Benchmarking default/deferredAsync: Collecting 100 samples in estimated 80.954 s (5050 iterations)
// Benchmarking default/deferredAsync: Analyzing
// default/deferredAsync   time: [15.940 ms 15.976 ms 16.016 ms]
// Found 8 outliers among 100 measurements (8%)
//   2 (2.00%) low mild
//   2 (2.00%) high mild
//   2 (2.00%) high severe
// slope  [15.940 ms 16.016 ms] R^2            [0.9844199 0.9842916]
// mean   [15.910 ms 16.107 ms] std. dev.      [159.92 µs 858.34 µs]
// median [15.894 ms 15.936 ms] med. abs. dev. [91.922 µs 167.17 µs]
// 
// 
// C:\Users\folkol\Downloads\criterion.js>npm i -g bun@1.1.2
// 
// changed 3 packages in 6s
// 
// C:\Users\folkol\Downloads\criterion.js>bun tests/comparison.manual.js criterion
// Benchmarking default/largeAsync
// Benchmarking default/largeAsync: Warming up for 3.0000 s
// Benchmarking default/largeAsync: Collecting 100 samples in estimated 6.3098 s (10k iterations)
// Benchmarking default/largeAsync: Analyzing
// default/largeAsync      time: [628.91 µs 631.09 µs 634.09 µs]
// Found 9 outliers among 100 measurements (9%)
//   1 (1.00%) low mild
//   1 (1.00%) high mild
//   8 (8.00%) high severe
// slope  [628.91 µs 634.09 µs] R^2            [0.9249901 0.9237331]
// mean   [634.71 µs 728.76 µs] std. dev.      [17.031 µs 470.50 µs]
// median [628.41 µs 632.36 µs] med. abs. dev. [5.1958 µs 10.328 µs]
// 
// C:\Users\folkol\Downloads\criterion.js>bun tests/comparison.manual.js criterion
// Benchmarking default/largeAsync
// Benchmarking default/largeAsync: Warming up for 3.0000 s
// Benchmarking default/largeAsync: Collecting 100 samples in estimated 6.9828 s (15k iterations)
// Benchmarking default/largeAsync: Analyzing
// default/largeAsync      time: [455.23 µs 457.42 µs 460.32 µs]
// Found 13 outliers among 100 measurements (13%)
//   2 (2.00%) low mild
//   2 (2.00%) high mild
//   9 (9.00%) high severe
// slope  [455.23 µs 460.32 µs] R^2            [0.8987896 0.8967889]
// mean   [460.08 µs 556.59 µs] std. dev.      [9.3075 µs 523.01 µs]
// median [457.87 µs 459.48 µs] med. abs. dev. [2.6191 µs 6.3992 µs]
// 
// C:\Users\folkol\Downloads\criterion.js>bun tests/comparison.manual.js criterion
// Benchmarking default/large
// Benchmarking default/large: Warming up for 3.0000 s
// Benchmarking default/large: Collecting 100 samples in estimated 7.0304 s (15k iterations)
// Benchmarking default/large: Analyzing
// default/large           time: [458.84 µs 459.86 µs 460.87 µs]
// Found 19 outliers among 100 measurements (19%)
//   4 (4.00%) low mild
//   4 (4.00%) high mild
//   7 (7.00%) high severe
// slope  [458.84 µs 460.87 µs] R^2            [0.9613151 0.9613463]
// mean   [463.76 µs 521.84 µs] std. dev.      [12.942 µs 257.40 µs]
// median [461.05 µs 462.95 µs] med. abs. dev. [2.6095 µs 5.3697 µs]
// 
// C:\Users\folkol\Downloads\criterion.js>bun tests/comparison.manual.js performance_hooks
// Running once for warm-up
// empty 79093.52492948812 ops/s
// emptyAsync 11926.928954146684 ops/s
// trivial 27219.594624021185 ops/s
// trivialAsync 9306.87859297865 ops/s
// medium 255.58713476598538 ops/s
// mediumAsync 220.37450443283265 ops/s
// large 2.172727490000023 ops/s
// largeAsync 2.1203349450706033 ops/s
// deferred 294.3340691685031 ops/s
// deferredAsync 0.06261196702400507 ops/s
// 
// Running for real!
// empty 61728.39506172839 ops/s
// emptyAsync 11134.843173528292 ops/s
// trivial 47661.8525018186 ops/s
// trivialAsync 8442.856887159196 ops/s
// medium 163.31570068151407 ops/s
// mediumAsync 186.24956696975784 ops/s
// large 2.1669449023921437 ops/s
// largeAsync 2.173768440621115 ops/s
// deferred 1480.16577857012 ops/s
// deferredAsync 0.06237292257703384 ops/s
