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
