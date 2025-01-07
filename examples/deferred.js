import {Criterion} from '../index.js';

function f(n) {
    return new Promise(resolve => setTimeout(resolve, n));
}

let criterion = new Criterion({
    slope: 1,
    sampleSize: 20,
    warmUpTime: 0.1,
    measurementTime: 5
});
let group = criterion.group('Shallow');
group.bench('Pretty Fast', f, 1);
group.bench('Pretty Slow', f, 2);
