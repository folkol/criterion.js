import {Criterion} from '../index.mjs';
import {fibonacciFast, fibonacciFast2, fibonacciSlow} from "./funcs.mjs";

console.log(fibonacciFast(20))
console.log(fibonacciFast2(20))
console.log(fibonacciSlow(20))

let criterion = new Criterion({
    measurementTime: 0.1,
    nResamples: 10,
    warmUpTime: 0.1,
});

let group = criterion.benchmarkGroup("Fibonacci");

group.bench("Empty", () => {});
group.bench("Empty (async)", async () => {});
group.bench("Iterative", fibonacciFast2, 15);
group.bench("Iterative (async)", fibonacciFast, 15);
group.bench("Recursive", fibonacciSlow, 15);
