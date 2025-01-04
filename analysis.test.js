import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {calculateEstimates, Data, dot, regression, Sample, tukey} from './analysis.js';

const CONFIG = {confidenceLevel: 0.95, nResamples: 100};

let randomNumbers = [0, 1, 3, 6, 2, 7, 13, 20, 12, 21, 11, 22, 10, 23, 9, 24, 8, 25, 43, 62, 42];

describe('tukey', () => {
    it("Should calculate Tukey's fences for outlier classification", () => {
        assert.deepEqual(tukey(randomNumbers), [-41, -17, 47, 71])
    });
})

describe('calculateEstimates', () => {
    it("Should calculate estimates", () => {
        let [distributions, estimates] = calculateEstimates(randomNumbers, CONFIG);
        assert.equal(distributions.mean.numbers.length, 100)
        assert(distributions.mean.numbers.every(Number.isFinite))
        assert(Math.abs(estimates.mean.pointEstimate - 17.333) < 0.001);
        assert(estimates.mean.confidenceInterval.upperBound > 17.333)
        assert(estimates.mean.confidenceInterval.lowerBound < 17.333)
    })
})

describe('dot', () => {
    it('should calculate dot product', () => {
        assert.equal(dot([1, 2, 3], [4, 5, 6]), 32)
    })
})

describe('regression', () => {
    it('should calculate ', () => {
        let [distribution, estimate] = regression(new Data(randomNumbers, randomNumbers.map(x => x * 2)), CONFIG);
        assert(distribution.numbers.every(x => x === 2))
        assert.equal(estimate.pointEstimate, 2)
        assert.equal(estimate.confidenceInterval.lowerBound, 2)
        assert.equal(estimate.confidenceInterval.upperBound, 2)
    })
})

describe('Sample', () => {
    it('should store the numbers', () => {
        let sample = new Sample(randomNumbers);
        assert.equal(sample.numbers, randomNumbers)
    })
    it('should calculate some statistics', () => {
        let sample = new Sample(randomNumbers);
        assert(Math.abs(sample.mean() - 17.333) < 0.001)
        assert(Math.abs(sample.stdDev() - 15.780) < 0.001)
        assert(Math.abs(sample.medianAbsDev(10) - 13.343) < 0.001)
    })
    it('should be able to bootstrap', () => {
        let sample = new Sample([1]);
        let [
            distMean,
            distStdDev,
            distMedian,
            distMad
        ] = sample.bootstrap(CONFIG.nResamples, _ => [1, 2, 3, 4]);
        assert(distMean.numbers.every(x => x === 1))
        assert(distStdDev.numbers.every(x => x === 2))
        assert(distMedian.numbers.every(x => x === 3))
        assert(distMad.numbers.every(x => x === 4))
    })
})
