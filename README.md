# Criterion.js

Criterion.js is a micro-benchmarking tool inspired by [Criterion.rs](https://crates.io/crates/criterion) which is inspired by [Criterion.hs](https://crates.io/crates/criterion) which was inspired by an unnamed benchmarking framework introduced in a series of blog posts by Brent Boyer. (The blog posts were published on IBM's developerWorks which has since been decommissioned, but copies of the posts can still -- at the time of writing -- be found in [the Internet Archive](https://web.archive.org/web/20090213185454/https://www.ibm.com/developerWorks/java/library/j-benchmark2).)

## What does it do?

For each of your bench tests, it does something like this:

1. runs your function in a loop get the system up-to-speed (JIT compilation, system caches, CPU throttling, etc.)
2. runs your code a few times more in order to take measurements
3. calculates some statistics for these measurements
4. generates a report

## Caveats

Micro-benchmarking is what it is, if your production code isn't executed in a tight loop isolated from the outside world the results from these test might not apply to the real world.

## How do I get it?

```
$ npm install (--save-dev) @folkol/criterions
```

## How do I use it?

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

What about runner?

```
$ node path/to/my/benchmark.js
```

```
$ npx criterion  # will find test under ./benches and run all of them
```
