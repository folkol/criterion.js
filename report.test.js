import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {scaleValues, formatShort, formatMeasurement, formatTime} from "./report.js";

describe('scaleValues', () => {
    it('should scale up really tiny numbers', () => {
        let tinyNumbers = [1e-12, 2e-12, 3e-12];
        let unit = scaleValues(tinyNumbers[0], tinyNumbers);
        assert.equal(unit, 'ps')
        assert.deepEqual(tinyNumbers, [1e-9, 2e-9, 3e-9])
    })
    it('should leave tiny numbers as-is', () => {
        let tinyNumbers = [1, 2, 3];
        let unit = scaleValues(tinyNumbers[0], tinyNumbers);
        assert.equal(unit, 'ns')
        assert.deepEqual(tinyNumbers, [1, 2, 3])
    })
    it('should scale down larger numbers', () => {
        let tinyNumbers = [1e6, 2e6, 3e6];
        let unit = scaleValues(tinyNumbers[0], tinyNumbers);
        assert.equal(unit, 'ms')
        assert.deepEqual(tinyNumbers, [1, 2, 3])
    })
})

describe('formatShort', () => {
    it('should format various magnitudes to same length for display in a table', () => {
        assert.equal(formatShort(1), '1.0000')
        assert.equal(formatShort(10), '10.000')
        assert.equal(formatShort(100), '100.00')
        assert.equal(formatShort(1000), '1000.0')
        assert.equal(formatShort(10000), '10000')
    })
    it('should not truncate large numbers', () => {
        assert.equal(formatShort(100000), '100000')
        assert.equal(formatShort(1234567890), '1234567890')
    })
})

describe('formatMeasurment', () => {
    it('should format to fixed width', () => {
        assert.equal(formatMeasurement(123), '123.00 ns')
        assert.equal(formatMeasurement(123e-8), '0.0012 ps')
        assert.equal(formatMeasurement(3.1337e13), '31337  s')
    })
})

describe('formatTime', () => {
    it('should rescale time', () => {
        assert.equal(formatTime(1e-3), '1.0000 ps');
        assert.equal(formatTime(1), '1.0000 ns');
        assert.equal(formatTime(1e3), '1.0000 µs');
        assert.equal(formatTime(1e6), '1.0000 ms');
        assert.equal(formatTime(1e9), '1.0000 s');
        assert.equal(formatTime(1e12), '1000.0 s');
    })
})
