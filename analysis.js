import fs from 'node:fs';
import path from 'node:path';

function tukey(sample) {
    let [q1, _, q3] = sample.percentiles().quartiles();
    let iqr = q3 - q1;
    let k_m = 1.5;
    let k_s = 3;

    return {
        fences: [
            q1 - k_s * iqr,
            q1 - k_m * iqr,
            q3 + k_m * iqr,
            q3 + k_s * iqr,
        ],
        sample
    }
}

class Percentiles {
    constructor(numbers) {
        if (numbers.length === 0) {
            throw "Can't calculate Percentiles for empty list!";
        }

        this.numbers = numbers.toSorted((a, b) => a - b);
    }

    at(p) {
        if (p < 0 || p > 100) {
            throw `Undefined percentile: ${p}`;
        }
        let len = this.numbers.length - 1;
        if (p === 100) {
            return this.numbers[len];
        }
        let rank = (p / 100) * len;
        let integer = Math.floor(rank);
        let fraction = rank - integer;
        let floor = this.numbers[integer];
        let ceiling = this.numbers[integer + 1];

        return floor + (ceiling - floor) * fraction;
    }

    quartiles() {
        return [
            this.at(25),
            this.at(50),
            this.at(75),
        ]
    }

    median() {
        return this.at(50);
    }
}

class Distribution {
    numbers = []

    push(x) {
        this.numbers.push(x);
    }

    confidenceInterval(cl) {
        if (cl <= 0 || cl >= 1) {
            throw 'Unsupported cl!';
        }
        let percentiles = new Sample(this.numbers).percentiles();
        return [percentiles.at(50 * (1 - cl)), percentiles.at(50 * (1 + cl))]
    }

    stdDev() {
        return new Sample(this.numbers).stdDev();
    }
}

export class Sample {
    constructor(numbers) {
        this.numbers = numbers;
    }

    var() {
        let mean = this.mean()
        return this.numbers.map(x => (x - mean) ** 2).reduce((acc, x) => acc + x) / (this.numbers.length - 1)
    }

    mean() {
        let n = this.numbers.length;
        return this.numbers.reduce((acc, x) => acc + x) / n;
    }

    stdDev() {
        return Math.sqrt(this.var());
    }

    percentiles() {
        return new Percentiles(this.numbers);
    }

    medianAbsDev(median) {
        let absDevs = this.numbers.map(x => Math.abs(x - median));
        return new Sample(absDevs).percentiles().median() * 1.4826;
    }

    bootstrap(nResamples, stats) {
        function resample(numbers) {
            return new Sample(numbers.map(() => numbers[Math.floor(Math.random() * numbers.length)]));
        }

        let distMean = new Distribution;
        let distStdDev = new Distribution;
        let distMedian = new Distribution;
        let distMad = new Distribution;
        for (let i = 0; i < nResamples; i++) {
            let [mean, stdDev, median, mad] = stats(resample(this.numbers));
            distMean.push(mean);
            distStdDev.push(stdDev);
            distMedian.push(median);
            distMad.push(mad);
        }
        return [
            distMean,
            distStdDev,
            distMedian,
            distMad,
        ];
    }
}

class Data {
    constructor(xs, ys) {
        if (xs.length !== ys.length || xs.length <= 1 || xs.some(x => isNaN(x)) || ys.some(y => isNaN(y))) {
            throw new Error(`Can't create Dataset from xs and ys ${xs.length} ${ys.length} ${xs.some(x => isNaN(x))} ${ys.some(y => isNaN(y))}`);
        }

        this.xs = xs;
        this.ys = ys;
    }

    bootstrap(nResamples, stats) {
        function resample(xs, ys) {
            let outXs = [];
            let outYs = [];
            for (let i = 0; i < xs.length; i++) {
                let j = Math.floor(Math.random() * xs.length);
                outXs.push(xs[i]);
                outYs.push(ys[j]);
            }
            return new Data(outXs, outYs);
        }

        let slopes = new Distribution;
        for (let i = 0; i < nResamples; i++) {
            let slope = stats(resample(this.xs, this.ys));
            slopes.push(slope);
        }
        return slopes;
    }

}

class ConfidenceInterval {
    constructor(confidence_level, lower_bound, upper_bound) {
        this.confidence_level = confidence_level;
        this.lower_bound = lower_bound;
        this.upper_bound = upper_bound;
    }
}

class Estimate {
    constructor(confidence_interval, point_estimate, standard_error) {
        this.confidence_interval = confidence_interval;
        this.point_estimate = point_estimate;
        this.standard_error = standard_error;
    }
}

class Estimates {
    constructor(mean, median, medianAbsDev, slope, stdDev) {
        this.mean = mean;
        this.median = median;
        this.medianAbsDev = medianAbsDev;
        this.slope = slope;
        this.stdDev = stdDev;
    }

    typical() {
        return this.slope ?? this.mean;
    }
}

function buildEstimates(distributions, points, cl) {
    function toEstimate(pointEstimate, distribution) {
        let [lb, ub] = distribution.confidenceInterval(cl);
        return new Estimate(
            new ConfidenceInterval(cl, lb, ub),
            pointEstimate,
            distribution.stdDev()
        );
    }

    return new Estimates(
        toEstimate(points.mean, distributions.mean),
        toEstimate(points.median, distributions.median),
        toEstimate(points.mad, distributions.medianAbsDev),
        null,
        toEstimate(points.stdDev, distributions.stdDev),
    )
}

export class Slope {
    static fit(data) {
        let xs = data.xs;
        let ys = data.ys;
        let xy = dot(xs, ys);
        let x2 = dot(xs, xs);
        return xy / x2
    }

    static rSquared(m, data) {
        let xs = data.xs;
        let ys = data.ys;

        let n = xs.length;
        let y_bar = ys.reduce((acc, x) => acc + x) / n;

        let ss_res = 0;
        let ss_tot = 0;

        for (let [x, y] of data.xs.map((x, i) => [x, ys[i]])) {
            ss_res = ss_res + (y - m * x) ** 2;
            ss_tot = ss_res + (y - y_bar) ** 2;
        }

        return 1 - ss_res / ss_tot
    }
}

function calculateEstimates(sample, config) {
    function stats(sample) {
        let mean = sample.mean();
        let stdDev = sample.stdDev(mean);
        let median = sample.percentiles().median();
        let mad = sample.medianAbsDev(median);

        return [mean, stdDev, median, mad];
    }

    let cl = config.confidenceLevel;
    let nResamples = config.nResamples;

    let [mean, stdDev, median, mad] = stats(sample);
    let points = {
        mean, stdDev, median, mad
    };

    let [distMean, distStdDev, distMedian, distMad] = sample.bootstrap(nResamples, stats);
    let distributions = {
        mean: distMean,
        slope: null,
        median: distMedian,
        medianAbsDev: distMad,
        stdDev: distStdDev
    };

    let estimates = buildEstimates(distributions, points, cl)

    return [distributions, estimates];
}

function dot(xs, ys) {
    return xs.map((x, i) => [x, ys[i]]).reduce((acc, [x, y]) => acc + x * y, 0);
}

function regression(data, config) {
    let cl = config.confidenceLevel;
    let distribution = data.bootstrap(config.nResamples, d => Slope.fit(d))
    let point = Slope.fit(data);
    let [lb, ub] = distribution.confidenceInterval(config.confidenceLevel);
    let se = distribution.stdDev();
    return [
        distribution,
        new Estimate(new ConfidenceInterval(cl, lb, ub), point, se)
    ]
}

class MeasurementData {
    constructor(data, labeledSample, absoluteEstimates, distributions) {
        this.data = data;
        this.avgTimes = labeledSample;
        this.absoluteEstimates = absoluteEstimates;
        this.distributions = distributions;
    }
}

export async function common(
    id,
    routine,
    config,
    criterion,
    reportContext,
    parameter
) {
    criterion.report.benchmarkStart(id, reportContext)
    let [samplingMode, iters, times] = await routine.sample(
        criterion.measurement,
        id,
        config,
        criterion,
        reportContext,
        parameter
    );
    criterion.report.analysis(id, reportContext);

    if (times.some((f) => f === 0)) {
        console.error(
            "At least one measurement of benchmark {} took zero time per \
            iteration. This should not be possible. If using iter_custom, please verify \
            that your routine is correctly measured.",
            id.title()
        );
        return;
    }

    let timeAverages = iters.map((n, i) => times[i] / n);
    let avgTimes = new Sample(timeAverages);

    let data = new Data(iters, times);
    let labeledSample = tukey(avgTimes);

    let where = path.join(criterion.outputDirectory, id.fullId);
    fs.mkdirSync(where, {recursive: true});
    fs.writeFileSync(path.join(where, 'tukey.json'), JSON.stringify(labeledSample.fences));

    let [distributions, estimates] = calculateEstimates(avgTimes, config);

    // if sampling mode is linear
    let [distribution, slope] = regression(data, config);
    estimates.slope = slope;
    distributions.slope = distribution;

    fs.writeFileSync(path.join(where, 'sample.json'), JSON.stringify({samplingMode, iters, times}));
    fs.writeFileSync(path.join(where, 'estimates.json'), JSON.stringify(estimates));

    let measurementData = new MeasurementData(new Data(iters, times), labeledSample, estimates, distributions);
    criterion.report.measurementComplete(id, reportContext, measurementData, criterion.measurement)
    fs.writeFileSync(path.join(where, 'benchmark.json'), JSON.stringify(id));
}
