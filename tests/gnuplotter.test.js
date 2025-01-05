import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {GnuPlotter} from "../gnuplotter.js";
import {Measurements} from "../models.js";
import fs from "node:fs";

describe('GnuPlotter', t => {
    it('should quote title', t => {
        let outputDirectory = fs.mkdtempSync('criterion-test')
        try {

            let script = '';
            t.mock.method(GnuPlotter, 'doPlot', s => {
                script = s
            });
            let awesomeTitle = "'\nsystem(\"touch hacker-was-here\")\n";
            let measurements = new Measurements([1, 2, 3], [1, 2, 4], [1, 2, 3, 4]);

            GnuPlotter.pdf(awesomeTitle, outputDirectory, measurements);

            assert(script.includes("set title '’ system(\"touch hacker-was-here\") "))
        } finally {
            fs.rmSync(outputDirectory, {recursive: true, force: true})
        }
    })
})
