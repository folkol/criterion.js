import { Criterion } from '../index.js';

function f(n) {
    return new Promise(resolve => setTimeout(resolve, n));
}

let criterion =new Criterion({slope: 0.01, warmUpTime: 0.1, measurementTime: 0.1 });
let group = criterion.group('Shallow');
group.bench('Pretty Fast', f, 4);
group.bench('Pretty Slow', f, 10);
