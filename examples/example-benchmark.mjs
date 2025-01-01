import {bench, Criterion, group} from '../index.mjs';
import {fibonacciAsync, fibonacciIterative, fibonacciRecursive} from "./funcs.mjs";

let criterion = new Criterion({
    measurementTime: 0.1,
    nResamples: 10,
    warmUpTime: 0.2,
});

bench('Hello', () => {})

group('Fibonacci', () => {
    bench('Iterative', fibonacciIterative, 15)
    bench('Recursive', fibonacciRecursive, 15)

    group('Nested', () => {
        bench('Test', async () => {}, 15)
    })
})
