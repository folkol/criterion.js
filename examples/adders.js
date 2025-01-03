import {Criterion} from '../index.js';
import {addNewSchool, addOldSchool, addReduce} from "./funcs.js";

let criterion = new Criterion({
    measurementTime: 0.1,
    nResamples: 10,
    warmUpTime: 0.1,
});

let data = Array.from({length: 10_000}, Math.random);

let fibonacci = criterion.group('Adders');

fibonacci.bench('reduce', addReduce, data);
fibonacci.bench('for', addOldSchool, data);
fibonacci.bench('for...of', addNewSchool, data);
