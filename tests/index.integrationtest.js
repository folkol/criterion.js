import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {Criterion} from '../index.js';
import {Report} from '../report.js';
import {isNumericArray} from "../models.js";

describe('Criterion', () => {
    it('Should run some tests and report the results', async () => {
        let measurementReport = {};

        class TestReporter extends Report {
            measurementComplete(id, context, reportData) {
                measurementReport = reportData;
            }
        }

        let criterion = new Criterion({
            warmUpTime: 0.1,
            measurementTime: 0.1,
            nResamples: 10
        });
        criterion.report = new TestReporter;

        let numCalled = 0;

        function f() {
            numCalled++;
        }

        let g = criterion.group('my test group')

        await g.bench('my test function', f)

        assert(numCalled > 100)
        assert.equal(measurementReport.groupId, 'my test group')
        assert.equal(measurementReport.functionId, 'my test function');
        assert('measurements' in measurementReport)
        assert('statistics' in measurementReport)
        assert(isNumericArray(measurementReport.measurements.iters, 100))
        assert(isNumericArray(measurementReport.measurements.times, 100))
        assert(isNumericArray(measurementReport.measurements.tukey, 4))
        assert(isNumericArray(measurementReport.statistics.mean.bootstrap, 10))
        assert(isNumericArray(measurementReport.statistics.median.bootstrap, 10))
        assert(isNumericArray(measurementReport.statistics.medianAbsDev.bootstrap, 10))
        assert(isNumericArray(measurementReport.statistics.slope.bootstrap, 10))
        assert(isNumericArray(measurementReport.statistics.stdDev.bootstrap, 10))

        assert('estimates' in measurementReport.statistics.mean);
        let {lowerBound, pointEstimate, upperBound} = measurementReport.statistics.mean.estimates;
        assert(Number.isFinite(pointEstimate))
        assert(Number.isFinite(lowerBound))
        assert(lowerBound < pointEstimate)
        assert(Number.isFinite(upperBound))
        assert(upperBound > pointEstimate)
    })
})
