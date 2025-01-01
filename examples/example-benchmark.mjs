import {Criterion} from '../index.mjs';
import {fibonacciAsync, fibonacciIterative, fibonacciRecursive} from "./funcs.mjs";

let criterion = new Criterion({
    measurementTime: 0.1,
    nResamples: 10,
    warmUpTime: 0.2,
});

let group1 = criterion.benchmarkGroup("Empty");

group1.bench("Empty", () => {});
group1.bench("Empty (async)", async () => {});

let group2 = criterion.benchmarkGroup("Fibonacci");
group2.bench("Iterative", fibonacciIterative, 15);
group2.bench("Iterative (async)", fibonacciAsync, 15);
group2.bench("Recursive", fibonacciRecursive, 15);
