import {Criterion} from '../index.mjs';
import {fibonacciAsync, fibonacciIterative, fibonacciRecursive} from "./funcs.mjs";

console.log(fibonacciAsync(20))
console.log(fibonacciIterative(20))
console.log(fibonacciRecursive(20))

let criterion = new Criterion({
    measurementTime: 0.1,
    nResamples: 10,
    warmUpTime: 0.1,
});

let group = criterion.benchmarkGroup("Fibonacci");

group.bench("Empty", () => {});
group.bench("Empty (async)", async () => {});
group.bench("Iterative", fibonacciIterative, 15);
group.bench("Iterative (async)", fibonacciAsync, 15);
group.bench("Recursive", fibonacciRecursive, 15);
