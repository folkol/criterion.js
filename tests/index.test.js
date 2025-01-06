import {BenchmarkTarget} from "../index.js";
import {describe, it} from "node:test";
import assert from "node:assert/strict";


function randomFunction(x) {
    return x * x + 123;
}

describe('BenchmarkTarget', () => {
    it("should puke if the benchmark target doesn't call .iter()", async () => {
        try {
            await new BenchmarkTarget(randomFunction).warmUp(1e9);
            assert.fail('Expected .warmup to throw')
        } catch (e) {
        }
    })

    it('should return mean execution time', async () => {
        let bt = new BenchmarkTarget(bencher => bencher.iter(randomFunction));
        let met = await bt.warmUp(1e6, 100);
        assert(met > 0)
        assert(met < 1e6)
    })

    it('return a reasonable iteration count', async () => {
        let bt = new BenchmarkTarget(bencher => bencher.iter(randomFunction));
        let met = await bt.warmUp(1e6, 100);
        let targetTime = 1e9;

        let iters = bt.iterationCounts(met, 10, targetTime)
        let expectedTime = met * iters.reduce((acc, x) => acc + x);
        assert(expectedTime > targetTime / 2)
        assert(expectedTime < targetTime * 2)
    })

    it('should keep a similar total iteration count when sampleSize changes', async () => {
        let bt = new BenchmarkTarget(bencher => bencher.iter(randomFunction));
        let met = await bt.warmUp(1e6, 100);
        let targetTime = 1e9;

        function numIters(sampleCount) {
            let iters = bt.iterationCounts(met, sampleCount, targetTime)
            return iters.reduce((acc, x) => acc + x);
        }

        let a = numIters(10);
        let b = numIters(1000);

        assert(a > b / 2)
        assert(a < b * 2)
    })

    it('slope argument affects the iterCount slope', async () => {
        let bt = new BenchmarkTarget(bencher => bencher.iter(randomFunction));
        let met = await bt.warmUp(1e6, 100);
        let targetTime = 1e9;
        let sampleCount = 100;

        function iterSlope(slope) {
            let iters = bt.iterationCounts(met, sampleCount, targetTime, slope)
            return iters[iters.length - 1] / iters[0] / iters.length;
        }

        let a = iterSlope(1);
        assert(a > 0.1, `was ${a}`);
        assert(a < 2, `was ${a}`);

        let b = iterSlope(0.1);
        assert(b > 0.05, `was ${b}`);
        assert(b < 0.15, `was ${b}`);
    })

    it('should keep similar total iteration count when slope changes', async () => {
        let bt = new BenchmarkTarget(bencher => bencher.iter(randomFunction));
        let met = await bt.warmUp(1e6, 100);
        let targetTime = 1e9;
        let sampleCount = 100;

        function numIters(slope) {
            let iters = bt.iterationCounts(met, sampleCount, targetTime, slope)
            return iters.reduce((acc, x) => acc + x);
        }

        let a = numIters(1);
        let b = numIters(0.1);

        assert(a > b / 2, `was ${a} (${b})`)
        assert(a < b * 2, `was ${a} (${b})`)
    })

    it('should return integer iteration counts', async () => {
        let bt = new BenchmarkTarget(bencher => bencher.iter(randomFunction));
        let met = await bt.warmUp(1e6, 100);
        let sampleCount = 100;
        let targetTime = 1e9;

        assert(bt.iterationCounts(met, sampleCount, targetTime).every(Number.isInteger));
        assert(bt.iterationCounts(met, sampleCount, targetTime, 0.1).every(Number.isInteger));
    })
})
