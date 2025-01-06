import {group, bench} from '../index.js';
import {fibonacciAsync, fibonacciIterative, fibonacciRecursive} from "./funcs.js";

bench('Hello Jasmine', () => {})
bench('Hello Jasmine Async', async () => {})

group('Fibonacci Jasmine', () => {
    bench('Iterative', fibonacciIterative, 15);
    group('SubGroup', () => {
        bench('Iterative Async', fibonacciAsync, 15);
        bench('Recursive', fibonacciRecursive, 15);
    })
})
