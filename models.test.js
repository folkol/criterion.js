import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {isNumericArray} from "./models.js";

describe('isNumericArray', () => {
    it('should accept numeric array', () => {
        assert(isNumericArray([1, 2, 3]))
    })
    it('should reject the empty array', () => {
        assert(!isNumericArray([]))
    })
    it('should reject array with NaNs', () => {
        assert(!isNumericArray([1, 2, 3, NaN]))
    })
    it('should reject array with Infinities', () => {
        assert(!isNumericArray([1, 2, 3, Infinity]))
        assert(!isNumericArray([1, 2, 3, -Infinity]))
    })
    it('should reject array with non-numbers', () => {
        assert(!isNumericArray(['1', 2, 3]))
        assert(!isNumericArray([1, null, 3]))
    })
})
