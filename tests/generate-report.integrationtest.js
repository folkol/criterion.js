import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {Criterion} from '../index.js';
import child_process from 'node:child_process'
import fs from "node:fs";
import path from "node:path";
import {slugify} from "../utils.js";

describe('generate-report', () => {
    it('should generate a report', async () => {
        let groupId = 'My Test Group! 🤘';
        let functionId = 'My Test Function! ❤️';

        let outputDirectory = fs.mkdtempSync('criterion-test')
        try {
            let criterion = new Criterion({
                warmUpTime: 0.1,
                measurementTime: 0.1,
                nResamples: 10,
                outputDirectory
            });
            let group = criterion.group(groupId)

            let f = length => Array.from({length}).reduce((acc, x) => acc + x);
            await group.bench(functionId, f, 100);

            let result = child_process.spawnSync("./generate-report.js", [outputDirectory]);

            assert(!result.error)
            assert.equal(result.status, 0)
            let functionDir = path.join(outputDirectory, slugify(groupId), slugify(functionId));
            assert(fs.existsSync(path.join(functionDir, 'benchmark.json')))

            let reportDir = path.join(functionDir, 'report');
            let expectedPlots = [
                'stdDev.svg',
                'pdf.svg',
                'pdf_small.svg',
                'median.svg',
                'mad.svg',
                'slope.svg',
                'regression.svg',
                'regression_small.svg',
                'mean.svg'
            ];
            for (let f of expectedPlots) {
                let plotPath = path.join(reportDir, f);
                assert(fs.existsSync(plotPath), `expected to find ${plotPath}`)
                let svg = fs.readFileSync(plotPath).toString();
                assert(/<?xml version/.test(svg))
                assert(/<svg/.test(svg))
                assert(/<title>Gnuplot<\/title>/.test(svg))
                let numbers = svg.match(/\d+/g);
                assert(numbers.length > 1000)
            }

            let indexPath = path.join(reportDir, 'index.html');
            assert(fs.existsSync(indexPath))

            let report = fs.readFileSync(indexPath).toString();
            assert(report.includes(groupId));
            assert(report.includes(functionId));
            assert(!report.includes('NaN'));
            assert(/<td class="ci-bound">\d\.\d\d\d\d/.test(report));
        } finally {
            fs.rmSync(outputDirectory, {recursive: true, force: true});
        }
    })
})

