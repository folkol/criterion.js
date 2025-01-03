import {Criterion} from '../index.js';
import {fibonacciAsync, fibonacciIterative, fibonacciRecursive} from "./funcs.js";

let criterion = new Criterion({
    measurementTime: 0.1,
    nResamples: 10,
    warmUpTime: 0.1,
});

let group = criterion.group('Default');
group.bench('Hello', () => {})
group.bench('Hello Async', async () => {})

let fibonacci = criterion.group('Fibonacci');

fibonacci.bench('Iterative', fibonacciIterative, 15);
fibonacci.bench('Iterative Async', fibonacciAsync, 15);
fibonacci.bench('Recursive', fibonacciRecursive, 15);
