# Criterion.js

Criterion.js is a micro-benchmarking tool (heavily!) inspired by [Criterion.rs](https://crates.io/crates/criterion) which is inspired by [Criterion.hs](https://crates.io/crates/criterion) which was inspired by an unnamed benchmarking framework introduced in a series of blog posts by Brent Boyer. (The blog posts were published on IBM's developerWorks which has since been decommissioned, but copies of the posts can still be found in [the Internet Archive](https://web.archive.org/web/20090213185454/https://www.ibm.com/developerWorks/java/library/j-benchmark2).)

## What does it do?

For each of your benchmarks, it does something like this:

1. runs your benched function in a loop for some time in order to get the system up-to-speed (JIT compilation, various system caches, CPU P-states, etc.)
2. runs your code a few times more in order to measure its performance (awaiting the result if the benched function is 'thenable')
3. calculates some statistics for these measurements
4. generates a report

## Caveats

Micro-benchmarking is what it is, if your production code isn't executed in a tight loop isolated from the outside world the results from these test might not apply to the real world.

## How do I get it?

WIP: Not published yet!

```
$ npm install (--save-dev) @folkol/criterion
```

## How do I use it?

WIP: Not published yet!

1. Create a Criterion instance
2. Create a benchmark group
3. Bench a number of functions
4. Generate the report

```
import bench from '@folkol/criterion'
import f from 'my-module'

[//]: # (Bencher.bench&#40;f&#41;)
bench('My Function', f)

[//]: # (group&#40;'My Functions', bencher => {)
[//]: # (    bencher.bench&#40;'My Function', f&#41;;)
[//]: # (    bencher.bench&#40;'My Other Function', g&#41;;)
[//]: # (}&#41;;)
```

## How do I run it?

```
$ node path/to/my/example-benchmark.mjs
```

## TODO

- More plots
- Create group reports
- Add more bench functions (Parameterized tests, tests of functions that consume their input, etc.)
- Separate report generation into its own package
