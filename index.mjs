import * as Analysis from "./analysis.js";
import {Sample, Slope} from "./analysis.js";
import fs from 'node:fs';
import path from 'node:path';
import {renderTemplate} from "./templates.mjs";
import child_process from 'node:child_process';

class Bencher {
    constructor(iterated,
                iters,
                value,
                measurement,
                elapsed_time) {
        this.iterated = iterated;
        this.iters = iters;
        this.value = value;
        this.measurement = measurement;
        this.elapsed_time = elapsed_time;
    }

    assertIterated() {
        if (!this.iterated) {
            console.error('Benchmark function must call Bencher::iter or related method.')
        }
        this.iterated = false;
    }

    async iter(f, ...input) {
        this.iterated = true;
        let timeStart = performance.now();
        let start = this.measurement.start();
        let sink = null;
        if (typeof f.then === "function") {
            for (let i = 0; i < this.iters; i++) {
                sink = await f(...input);
            }
        } else {
            for (let i = 0; i < this.iters; i++) {
                sink = f(...input)
            }
        }
        blackbox(sink);
        this.value = this.measurement.end(start)
        this.elapsed_time = (performance.now() - timeStart) * 1e6;  // as nanos, for now
    }
}

class GroupBenchmarkId {
    name;
    _parameter;

    constructor(name) {
        this.name = name;
    }
}

export class InternalBenchmarkId {
    constructor(groupId, functionId, valueString, throughput) {
        this.groupId = groupId;
        this.functionId = functionId;
        this.valueString = valueString;
        this.throughput = throughput;
        if (groupId && valueString) {
            this.fullId = `${groupId}/${functionId}/${valueString}`;
        } else if (groupId) {
            this.fullId = `${groupId}/${functionId}`;
        } else {
            this.fullId = functionId;
        }
        this.title = this.fullId;
        this.directoryName = this.fullId;
    }
}

function iterationCounts(samplingMode, warmupMeanExecutionTime, sampleCount, targetTime) {
    // if samplingMode == Linear

    let n = sampleCount;
    let met = warmupMeanExecutionTime;
    let m_ns = targetTime;

    // Solve: [d + 2*d + 3*d + ... + n*d] * met = m_ns
    let totalRuns = n * (n + 1) / 2;
    let d = Math.max(1, (Math.ceil(m_ns / met / totalRuns)))
    let expectedNs = totalRuns * d * met;

    if (d === 1) {
        console.error(
            `\nWarning: Unable to complete ${n}`,
            `samples in ${targetTime}.`,
            `You may wish to increase target time to ${expectedNs}`,
        );
    }

    return Array(n).fill(1).map((_, i) => (i + 1) * d)
}

class Function {
    constructor(f) {
        this.f = f;
    }

    async sample(
        measurement,
        id,
        config,
        criterion,
        reportContext,
        parameter
    ) {
        let wu = config.warmUpTime * 1e9;

        criterion.report.warmup(id, reportContext, wu);

        let [wu_elapsed, wu_iters] = await this.warmUp(measurement, wu, parameter);

        let met = wu_elapsed / wu_iters;
        let n = config.sampleSize;

        let actualSamplingMode = 'linear'; // TODO
        let mIters = iterationCounts(actualSamplingMode, met, n, config.measurementTime * 1e9);
        let expectedNs = mIters.reduce((acc, x) => acc + x * met);
        let totalIters = mIters.reduce((acc, x) => acc + x);

        criterion.report.measurementStart(id, reportContext, n, expectedNs, totalIters);

        let times = (await this.bench(measurement, mIters, parameter)).map(x => Math.round(x))

        return [
            actualSamplingMode,
            mIters,
            times
        ]
    }

    async warmUp(measurement, howLong, parameter) {
        let f = this.f;
        let bencher = new Bencher(
            false,
            1,
            0,
            measurement,
            0,
        )
        let totalIters = 0;
        let elapsedTime = 0;
        while (elapsedTime < howLong) {
            await f(bencher, blackbox(parameter));
            bencher.assertIterated();
            totalIters += bencher.iters;
            elapsedTime += bencher.elapsed_time;
            bencher.iters *= 2;
        }

        return [elapsedTime, totalIters];
    }

    async bench(measurement, mIters, parameter) {
        let f = this.f;
        let results = []
        for (let n of mIters) {
            let bencher = new Bencher(
                false,
                n,
                0,
                measurement,
                0,
            )
            await f(bencher, parameter);
            bencher.assertIterated();
            results.push(bencher.value * 1e6);
        }
        return results;
    }
}

class BenchmarkGroup {
    constructor(criterion, name) {
        this.criterion = criterion;
        this.name = name;
    }

    async runBench(id, input, f) {
        let config = this.criterion.config;
        let reportContext = {
            outputDirectory: this.criterion.outputDirectory,
        };
        let internalId = new InternalBenchmarkId(
            this.name,
            id.name,
            id._parameter,
        );
        let func = new Function(f);

        await Analysis.common(internalId, func, config, this.criterion, reportContext, input)
    }

    bench(name, f, ...rest) {
        let task = async () => this.runBench(
            new GroupBenchmarkId(name),
            () => blackbox(rest),
            async (b, i) => await b.iter(f, ...i())
        );
        this.criterion.submit(task);
    }
}

class Report {
    benchmarkStart(_id, _context) {
    }

    warmup(_id, _context, _warmup_ns) {
    }

    analysis(_id, _context) {
    }

    measurementStart(
        _id,
        _context,
        _sample_count,
        _estimate_ns,
        _iter_count,
    ) {
    }

    measurementComplete(
        _id,
        _context,
        _measurements,
        _formatter,
    ) {
    }
}

function short(n) {
    if (n < 10.0) {
        return n.toFixed(4);
    } else if (n < 100.0) {
        return n.toFixed(3);
    } else if (n < 1000.0) {
        return n.toFixed(2);
    } else if (n < 10000.0) {
        return n.toFixed(10)
    } else {
        return n.toFixed(0);
    }
}

function formatTime(ns) {
    if (ns < 1.0) {
        return `${short(ns * 1e3)} ps`.padStart(6);
    } else if (ns < 10 ** 3) {
        return `${short(ns)} ns`.padStart(6)
    } else if (ns < 10 ** 6) {
        return `${short(ns / 1e3)} µs`.padStart(6);
    } else if (ns < 10 ** 9) {
        return `${short(ns / 1e6)} ms`.padStart(6);
    } else {
        return `${short(ns / 1e9)} s`.padStart(6)
    }
}

function formatIterCount(iterations) {
    if (iterations < 10_000) {
        return `${iterations} iterations`;
    } else if (iterations < 1_000_000) {
        return `${(iterations / 1000).toFixed(0)}k iterations`;
    } else if (iterations < 10_000_000) {
        let s = ((iterations) / (1000.0 * 1000.0)).toFixed(1);
        return `${s}M iterations`;
    } else if (iterations < 1_000_000_000) {
        let s = ((iterations) / (1000.0 * 1000.0)).toFixed(1);
        return `${s}M iterations`;
    } else if (iterations < 10_000_000_000) {
        let s = (iterations) / (1000.0 * 1000.0 * 1000.0).toFixed(1);
        return `${s}B iterations`;
    } else {
        let s = (iterations / (1000.0 * 1000.0 * 1000.0)).toFixed(0);
        return `${s}B iterations`;
    }
}

class CliReport extends Report {
    benchmarkStart(id, _context) {
        console.log('Benchmarking', id.title);
    }

    analysis(id, _context) {
        console.log(`Benchmarking ${id.title}: Analyzing`);
    }

    warmup(id, _context, warmup_ns) {
        console.log(`Benchmarking ${id.title}: Warming up for ${formatTime(warmup_ns)}`)
    }

    measurementStart(_id, _context, _sample_count, _estimate_ns, _iter_count) {
        console.log(
            `Benchmarking ${_id.title}:`,
            `Collecting ${_sample_count} samples in estimated`,
            `${formatTime(_estimate_ns)} (${formatIterCount(_iter_count)})`
        )
    }

    measurementComplete(_id, _context, _measurements, _formatter) {
        let typicalEstimate = _measurements.absoluteEstimates.typical();

        let id = _id.title;
        console.log(
            `${id.padEnd(23)} time:`,
            `[${_formatter.format(typicalEstimate.confidence_interval.lower_bound)}`,
            _formatter.format(typicalEstimate.point_estimate),
            `${_formatter.format(typicalEstimate.confidence_interval.upper_bound)}]`
        )

        if (_measurements.throughput) {
            // TODO
        }

        this.outliers(_measurements.avgTimes)

        let slopeEstimate = _measurements.absoluteEstimates.slope;

        function formatShortEstimate(estimate) {
            let lb = _formatter.format(estimate.confidence_interval.lower_bound);
            let ub = _formatter.format(estimate.confidence_interval.upper_bound);
            return `[${lb} ${ub}]`;
        }

        if (slopeEstimate) {
            let slop = formatShortEstimate(slopeEstimate);
            let lb = Slope.rSquared(slopeEstimate.confidence_interval.lower_bound, _measurements.data).toFixed(7);
            let ub = Slope.rSquared(slopeEstimate.confidence_interval.upper_bound, _measurements.data).toFixed(7);
            console.log(`slope  ${slop}`, `R^2            [${lb} ${ub}]`)
        }
        let mean = formatShortEstimate(_measurements.absoluteEstimates.mean);
        let stdDev = formatShortEstimate(_measurements.absoluteEstimates.stdDev);
        let median = formatShortEstimate(_measurements.absoluteEstimates.median);
        let medianAbsDev = formatShortEstimate(_measurements.absoluteEstimates.medianAbsDev);
        console.log(`mean   ${mean} std. dev.      ${stdDev}`)
        console.log(`median ${median} med. abs. dev. ${medianAbsDev}`);
    }

    outliers(labeledSample) {
        let [los, lom, noa, him, his] = [0, 0, 0, 0, 0];
        let [lost, lomt, himt, hist] = labeledSample.fences;
        for (let n of labeledSample.sample.numbers) {
            if (n < lost) {
                los += 1;
            } else if (n > hist) {
                his += 1;
            } else if (n < lomt) {
                lom += 1;
            } else if (n > himt) {
                him += 1;
            } else {
                noa += 1
            }
        }
        // return [los, lom, noa, him, his];
        let numOutliers = los + lom + him + his;
        let sampleSize = labeledSample.sample.numbers.length;
        if (numOutliers === 0) {
            return;
        }

        let percent = n => 100 * n / sampleSize;

        console.log(`Found ${numOutliers} outliers among ${sampleSize} measurements (${percent(numOutliers)}%)`)
        let print = (n, label) => {
            if (n !== 0) {
                console.log(`  ${n} (${percent(n).toFixed(2)}%) ${label}`);
            }
        }
        print(los, "low severe");
        print(him, "low mild");
        print(him, "high mild");
        print(his, "high severe");
    };
}

class ReportLink {
    constructor(name, pathOrNull) {
        this.name = name;
        this.pathOrNull = pathOrNull;
    }

    static group(outputDir, groupId) {
        let reportPath = path.join(outputDir, groupId, 'report', 'index.html')
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(groupId, pathOrNull)
    }

    static individual(outputDir, id) {
        let reportPath = id.directoryName;
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(id.title, pathOrNull);
    }

    static value(outputDir, groupId, value) {
        let reportPath = path.join(outputDir, groupId, value);
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(value, pathOrNull);
    }

    static function(outputDir, groupId, f) {
        let reportPath = path.join(outputDir, groupId, f);
        let pathOrNull = fs.existsSync(reportPath) ? reportPath : null;
        return new ReportLink(f, pathOrNull);
    }
}

class BenchmarkValueGroup {
    constructor(value, benchmarks) {
        this.value = value;
        this.benchmarks = benchmarks;
    }
}

export class HtmlBenchmarkGroup {
    constructor(groupReport, functionLinks, valueLinks, individualLinks) {
        this.groupReport = groupReport;
        this.functionLinks = functionLinks;
        this.valueLinks = valueLinks;
        this.valueGroups = individualLinks;
    }

    static fromGroup(outputDir, group) {
        this.outputDir = outputDir;
        this.group = group;
        let groupId = group[0].groupId;
        let groupReport = ReportLink.group(outputDir, groupId);
        let functionIds = [];
        let values = [];
        let individualLinks = new Map;
        for (let id of group) {
            let functionId = id.functionId;
            let value = id.value;
            let individualLink = ReportLink.individual(outputDir, id);
            functionIds.push(functionId);
            values.push(value);
            individualLinks.set(`${functionId}-${value}`, individualLink);
        }


        let uniqueSortedValues = [...new Set(values)];
        if (values.every(x => typeof x === 'number')) {
            uniqueSortedValues.sort((a, b) => b - a);
        } else {
            uniqueSortedValues.sort()
        }

        let uniqueSortedFunctionIds = [...new Set(functionIds)].toSorted();
        let valueGroups = [];
        for (let value of uniqueSortedValues) {
            let row = new Set;
            for (let functionId of uniqueSortedFunctionIds) {
                let key = `${functionId}-${value}`;
                let link = individualLinks.get(key);
                if (link) {
                    individualLinks.delete(key);
                    row.add(link);
                }
            }
            let valueOrNull = value ? ReportLink.value(outputDir, groupId, value) : null;
            valueGroups.push(new BenchmarkValueGroup(valueOrNull, [...row].toSorted()));
        }

        let functionLinks = uniqueSortedFunctionIds.map(f => ReportLink.function(outputDir, groupId, f));
        let valueLinks = uniqueSortedValues.map(value => value ? ReportLink.value(outputDir, groupId, value) : null);

        return new HtmlBenchmarkGroup(groupReport, functionLinks, valueLinks, valueGroups)
    }
}

class HtmlConfidenceInterval {
    constructor(lower, point, upper) {
        this.lower = lower;
        this.point = point;
        this.upper = upper;
    }
}

class Plot {
    constructor(name, url) {
        this.name = name;
        this.url = url;
    }
}

class PlotContext {
    constructor(id,
                context,
                size,
                is_thumbnail) {
        this.id = id;
        this.context = context;
        this.size = size;
        this.is_thumbnail = is_thumbnail;
    }
}

class PlotData {
    constructor(measurements, formatter, comparison) {
        this.measurements = measurements;
        this.formatter = formatter;
        this.comparison = comparison;
    }
}

class Kde {
    constructor(sample, bandwidth) {
        this.sample = sample;
        this.bandwidth = bandwidth;
    }

    estimate(x) {
        let slice = this.sample.numbers;
        let h = this.bandwidth;
        let n = slice.length;
        let sum = slice.reduce((acc, x_i) => acc + gauss((x - x_i) / h), 0);
        return sum / (h * n);
    }
}

function gauss(x) {
    return 1 / Math.sqrt(Math.exp(x ** 2) * 2 * Math.PI)
}

function silverman(sample) {
    let factor = 4 / 3;
    let exponent = 1. / 5.;
    let n = sample.numbers.length;
    let sigma = sample.stdDev();

    return sigma * (factor / n) ** exponent
}

function sweep_and_estimate(
    sample,
    npoints,
    range,
    point_to_estimate,
) {
    let x_min = Math.min(...sample.numbers);
    let x_max = Math.max(...sample.numbers);

    let kde = new Kde(sample, silverman(sample));
    let h = kde.bandwidth;
    let [start, end] = range ? range : [x_min - 3 * h, x_max + 3 * h];
    let xs = [];

    let step_size = (end - start) / (npoints - 1);
    for (let i = 0; i < npoints; i++) {
        xs.push(start + step_size * i)
    }
    let ys = xs.map(x => kde.estimate(x));
    let point_estimate = kde.estimate(point_to_estimate);
    return [xs, ys, point_estimate];
}

function pdf_small(id, context, formatter, measurements, size) {
    let iterCounts = measurements.data.xs;
    let maxIters = Math.max(...iterCounts);
    let exponent = 3 * Math.floor(Math.log10(maxIters) / 3)
    let yLabel = exponent ? `Iterations (x 10^${exponent})` : 'Iterations';

    let avg_times = measurements.avgTimes;
    let [lost, lomt, himt, hist] = measurements.avgTimes.fences;
    let scaled_numbers = [...avg_times.sample.numbers];
    let typical = Math.max(...scaled_numbers);
    let unit = formatter.scaleValues(typical, scaled_numbers)
    let scaled_avg_times = new Sample(scaled_numbers);
    let mean = scaled_avg_times.mean();
    let [xs, ys, mean_y] = sweep_and_estimate(scaled_avg_times, 500, null, mean);
    let figurePath = path.join(context.outputDirectory, id.directoryName, 'report', 'pdf_small.svg');

    let min_x = Math.min(...xs);
    let max_x = Math.max(...xs);
    let max_y = Math.max(...ys) * 1.1;

    let script = `set output '${figurePath}'
set xtics nomirror
set xlabel 'Average time (${unit})'
set xrange [${min_x}:${max_x}]
show xrange
set ytics nomirror
set ylabel 'Density (a.u.)'
set yrange [0:${max_y}]
unset y2tics
set key off
set terminal svg dynamic dashed size 450, 300 font 'Helvetica'
unset bars
plot '-' using 1:2:3 axes x1y2 with filledcurves fillstyle solid 0.25 noborder lc rgb '#1f78b4' title 'PDF', '-' using 1:2 with lines lt 1 lw 2 lc rgb '#1f78b4' title 'Mean'
`

    for (let [x, y] of xs.map((x, i) => [x, ys[i]])) {
        script += `${x} ${y} 0\n`;
    }
    script += 'e\n';
    script += `${mean} ${mean_y}\n`
    script += `${mean} 0\n`
    script += 'e\n';


    gnuplot(script);
}

function confidenceInterval(percentiles, confidence_level) {
    if (confidence_level <= 0 || confidence_level >= 1) {
        throw 'unexpected confidence level'
    }

    return [
        percentiles.at(50 * (1 - confidence_level)),
        percentiles.at(50 * (1 + confidence_level))
    ]
}

function regression(id, context, formatter, measurements, size) {
    let slopeEstimate = measurements.absoluteEstimates.slope;
    let slopeDist = measurements.distributions.slope;
    let [lb, ub] = confidenceInterval(new Sample(slopeDist.numbers).percentiles(), slopeEstimate.confidence_interval.confidence_level);

    let data = measurements.data;

    let [max_iters, typical] = [Math.max(...data.xs), Math.max(...data.ys)];
    let scaled_numbers = [...data.ys];
    let unit = formatter.scaleValues(typical, scaled_numbers);

    let point_estimate = Slope.fit(measurements.data);

    let scaled_points = [point_estimate * max_iters, lb * max_iters, ub * max_iters];

    formatter.scaleValues(typical, scaled_points);

    let [point, lb2, ub2] = scaled_points;

    let exponent = 3 * Math.floor(Math.log10(max_iters) / 3)
    let x_scale = 10 ** -exponent;

    let x_label = exponent === 0 ? "Iterations" : `Iterations (x 10^${exponent})`

    let figurePath = path.join(context.outputDirectory, id.directoryName, 'report', 'regression.svg');

    let script = `set output '${figurePath}'
set title 'Fibonacci/Iterative'
set xtics nomirror 
set xlabel '${x_label}'
set grid xtics
set ytics nomirror 
set ylabel 'Total sample time (${unit})'
set grid ytics
set key on inside top left Left reverse 
set terminal svg dynamic dashed size 1280, 720 font 'Helvetica'
unset bars
plot '-' using 1:2 with points lt 1 lc rgb '#1f78b4' pt 7 ps 0.5 title 'Sample', \
     '-' using 1:2 with lines lt 1 lw 2 lc rgb '#1f78b4' title 'Linear regression', \
     '-' using 1:2:3 with filledcurves fillstyle solid 0.25 noborder lc rgb '#1f78b4' title 'Confidence interval'    
`;

    for (let [x, y] of data.xs.map((x, i) => [x, scaled_numbers[i]])) {
        script += `${x} ${y} 0\n`;
    }
    script += 'e\n';

    script += `0 0\n`
    script += `${max_iters} ${point}\n`
    script += 'e\n';

    gnuplot(script);
}

function regression_small(id, context, formatter, measurements, size) {
    let slopeEstimate = measurements.absoluteEstimates.slope;
    let slopeDist = measurements.distributions.slope;
    let [lb, ub] = confidenceInterval(new Sample(slopeDist.numbers).percentiles(), slopeEstimate.confidence_interval.confidence_level);
    let data = measurements.data;
    let [max_iters, typical] = [Math.max(...data.xs), Math.max(...data.ys)];
    let scaled_numbers = [...data.ys];
    let unit = formatter.scaleValues(typical, scaled_numbers);
    let point_estimate = Slope.fit(measurements.data);
    let scaled_points = [point_estimate * max_iters, lb * max_iters, ub * max_iters];
    formatter.scaleValues(typical, scaled_points);
    let [point, lb2, ub2] = scaled_points;
    let exponent = 3 * Math.floor(Math.log10(max_iters) / 3)
    let x_scale = 10 ** -exponent;
    let x_label = exponent === 0 ? "Iterations" : `Iterations (x 10^${exponent})`

    let figurePath = path.join(context.outputDirectory, id.directoryName, 'report', 'regression_small.svg');

    let script = `set output '${figurePath}'
set xtics nomirror 
set xlabel '${x_label}'
set grid xtics
set ytics nomirror 
set ylabel 'Total sample time (${unit})'
set grid ytics
set key off
set terminal svg dynamic dashed size 450, 300 font 'Helvetica'
unset bars
plot '-' using 1:2 with points lt 1 lc rgb '#1f78b4' pt 7 ps 0.5 title 'Sample', \
     '-' using 1:2 with lines lt 1 lw 2 lc rgb '#1f78b4' title 'Linear regression', \
     '-' using 1:2:3 with filledcurves fillstyle solid 0.25 noborder lc rgb '#1f78b4' title 'Confidence interval'    
`;

    for (let [x, y] of data.xs.map((x, i) => [x * x_scale, scaled_numbers[i]])) {
        script += `${x} ${y} 0\n`;
    }
    script += 'e\n';

    script += `0 0\n`
    script += `${max_iters * x_scale} ${point}\n`
    script += 'e\n';

    gnuplot(script);
}


function gnuplot(script) {
    let result = child_process.spawnSync('gnuplot', [], {input: script});
    if (result.error) {
        console.error('Error spawning child process:', result.error);
    } else {
        if (result.status !== 0) {
            console.log('Child process output:', result.stdout.toString());
            console.log('Child process stderr:', result.stderr.toString());
            console.log('Exit code:', result.status);
        }
    }
}

function pdf(id, context, formatter, measurements, size) {
    throw 'WIP'

    let iterCounts = measurements.data.xs;
    let maxIters = Math.max(...iterCounts);
    let exponent = 3 * Math.floor(Math.log10(maxIters) / 3)
    let yLabel = exponent ? `Iterations (x 10^${exponent})` : 'Iterations';

    let avg_times = measurements.avgTimes;
    let [lost, lomt, himt, hist] = measurements.avgTimes.fences;
    let scaled_numbers = [...avg_times.sample.numbers];
    let typical = Math.max(...scaled_numbers);
    let unit = formatter.scaleValues(typical, scaled_numbers)
    let scaled_avg_times = new Sample(scaled_numbers);
    let mean = scaled_avg_times.mean();
    let [xs, ys, mean_y] = sweep_and_estimate(scaled_avg_times, 500, null, mean);
    let figurePath = path.join(context.outputDirectory, id.directoryName, 'report', 'pdf.svg');

    let min_x = Math.min(...xs);
    let max_x = Math.max(...xs);
    let max_y = Math.max(...ys) * 1.1;
    let script = `set output '${figurePath}'
set title 'Fibonacci/Iterative'
set xtics nomirror
set xlabel 'Average time (${unit})'
set xrange [${min_x}:${max_x}]
set ytics nomirror
set ylabel '${yLabel}'
set yrange [0:${max_y}]
set y2tics nomirror
set y2label 'Density (a.u.)'
set key on outside top right Left reverse
set terminal svg dynamic dashed size 1280, 720 font 'Helvetica'
unset bars
plot '-' using 1:2:3 axes x1y2 with filledcurves fillstyle solid 0.25 noborder lc rgb '#1f78b4' title 'PDF', \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#1f78b4' title 'Mean', \
     '-' using 1:2 with points lt 1 lc rgb '#1f78b4' pt 7 ps 0.75 title '"Clean" sample', \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#ff7f00' notitle, \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#ff7f00' notitle, \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#e31a1c' notitle, \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#e31a1c' notitle
`

    for (let [x, y] of xs.map((x, i) => [x, ys[i]])) {
        script += `${x} ${y} 0\n`;
    }
    script += 'e\n';

    // mean
    script += `${mean} ${mean_y}\n`
    script += `${mean} 0\n`
    script += 'e\n';

    // clean sample
    for (let [n, x, y] of avg_times.sample.numbers.map((x, i) => [x, scaled_avg_times.numbers[i], iterCounts[i]])) {
        if (n < lost) {
            // los += 1;
        } else if (n > hist) {
            // his += 1;
        } else if (n < lomt) {
            // lom += 1;
        } else if (n > himt) {
            // him += 1;
        } else {
            script += `${x} ${y}\n`
        }
    }
    script += 'e\n';

    // q1

    // q3

    // console.log(script);
    gnuplot(script);
}

class GnuPlotter {
    process_list = []

    pdf(ctx, data) {
        let size = ctx.size;
        this.process_list.push(
            ctx.is_thumbnail ?
                pdf_small(ctx.id, ctx.context, data.formatter, data.measurements, size)
                :
                pdf(ctx.id, ctx.context, data.formatter, data.measurements, size)
        );
    }

    regression(ctx, data) {
        this.process_list.push(ctx.is_thumbnail ?
            regression_small(ctx.id, ctx.context, data.formatter, data.measurements, ctx.size)
            :
            regression(ctx.id, ctx.context, data.formatter, data.measurements, ctx.size));
    }
}

class HtmlReport extends Report {
    constructor() {
        super();
    }

    measurementComplete(_id, _context, _measurements, _formatter) {
        // TODO: just write the data needed and render the report in another program?

        let report_dir = path.join(
            _context.outputDirectory,
            _id.directoryName,
            'report'
        )
        fs.mkdirSync(report_dir, {recursive: true});


        let typical_estimate = _measurements.absoluteEstimates.typical();


        let time_interval = est =>
            new HtmlConfidenceInterval(_formatter.format(est.confidence_interval.lower_bound),
                _formatter.format(est.point_estimate),
                _formatter.format(est.confidence_interval.upper_bound));


        let data = _measurements.data;

        this.generate_plots(_id, _context, _formatter, _measurements)

        let additional_plots = [
            // new Plot("Typical", "typical.svg"),
            // new Plot("Mean", "mean.svg"),
            // new Plot("Std. Dev.", "SD.svg"),
            // new Plot("Median", "median.svg"),
            // new Plot("MAD", "MAD.svg"),
        ];
        if (_measurements.absoluteEstimates.slope) {
            // additional_plots.push(new Plot("Slope", "slope.svg"));
        }

        let context = {
            title: _id.title,
            confidence: typical_estimate.confidence_interval.confidence_level.toFixed(2),
            thumbnail_width: 450,
            thumbnail_height: 300,

            slope: _measurements.absoluteEstimates.slope ? time_interval(_measurements.absoluteEstimates.slope) : null,
            mean: time_interval(_measurements.absoluteEstimates.mean),
            median: time_interval(_measurements.absoluteEstimates.median),
            mad: time_interval(_measurements.absoluteEstimates.medianAbsDev),
            std_dev: time_interval(_measurements.absoluteEstimates.stdDev),
            r2: new HtmlConfidenceInterval(
                Slope.rSquared(typical_estimate.confidence_interval.lower_bound, data).toFixed(7),
                Slope.rSquared(typical_estimate.point_estimate, data).toFixed(7),
                Slope.rSquared(typical_estimate.confidence_interval.upper_bound, data).toFixed(7),
            ),
            additional_plots,
            comparison: null,
        };

        let report_path = path.join(
            _context.outputDirectory,
            _id.directoryName,
            "report",
            "index.html");

        let output = renderTemplate('benchmark_report', context);
        fs.writeFileSync(report_path, output);
    }

    generate_plots(_id, _context, _formatter, _measurements) {

        let plotter = new GnuPlotter;

        let plot_ctx = new PlotContext(
            _id,
            _context,
            null,
            false,
        );


        let plot_data = new PlotData(
            _measurements,
            _formatter,
            null);


        let plot_ctx_small = new PlotContext(
            _id,
            _context,
            [450, 300],
            true,
        )

        plotter.pdf(plot_ctx_small, plot_data);
        // plotter.pdf(plot_ctx, plot_data);

        if (_measurements.absoluteEstimates.slope) {
            plotter.regression(plot_ctx_small, plot_data);
            // plotter.regression(plot_ctx, plot_data);
        }


        //         self.plotter.borrow_mut().pdf(plot_ctx_small, plot_data);
        //         if measurements.absolute_estimates.slope.is_some() {
        //             self.plotter.borrow_mut().regression(plot_ctx, plot_data);
        //             self.plotter
        //                 .borrow_mut()
        //                 .regression(plot_ctx_small, plot_data);
        //         } else {
        //             self.plotter
        //                 .borrow_mut()
        //                 .iteration_times(plot_ctx, plot_data);
        //             self.plotter
        //                 .borrow_mut()
        //                 .iteration_times(plot_ctx_small, plot_data);
        //         }
        //
        //         self.plotter
        //             .borrow_mut()
        //             .abs_distributions(plot_ctx, plot_data);
        //
        //         if let Some(ref comp) = measurements.comparison {
        //             try_else_return!({
        //                 let mut change_dir = context.output_directory.clone();
        //                 change_dir.push(id.as_directory_name());
        //                 change_dir.push("report");
        //                 change_dir.push("change");
        //                 fs::mkdirp(&change_dir)
        //             });
        //
        //             try_else_return!({
        //                 let mut both_dir = context.output_directory.clone();
        //                 both_dir.push(id.as_directory_name());
        //                 both_dir.push("report");
        //                 both_dir.push("both");
        //                 fs::mkdirp(&both_dir)
        //             });
        //
        //             let comp_data = plot_data.comparison(comp);
        //
        //             self.plotter.borrow_mut().pdf(plot_ctx, comp_data);
        //             self.plotter.borrow_mut().pdf(plot_ctx_small, comp_data);
        //             if measurements.absolute_estimates.slope.is_some()
        //                 && comp.base_estimates.slope.is_some()
        //             {
        //                 self.plotter.borrow_mut().regression(plot_ctx, comp_data);
        //                 self.plotter
        //                     .borrow_mut()
        //                     .regression(plot_ctx_small, comp_data);
        //             } else {
        //                 self.plotter
        //                     .borrow_mut()
        //                     .iteration_times(plot_ctx, comp_data);
        //                 self.plotter
        //                     .borrow_mut()
        //                     .iteration_times(plot_ctx_small, comp_data);
        //             }
        //             self.plotter.borrow_mut().t_test(plot_ctx, comp_data);
        //             self.plotter
        //                 .borrow_mut()
        //                 .rel_distributions(plot_ctx, comp_data);
        //         }
        //
        //         self.plotter.borrow_mut().wait();
    }
}

class CriterionConfig {
    confidenceLevel = 0.95;
    measurementTime = 5;
    noiseThreshold = 0.01;
    nResamples = 100_000;
    sampleSize = 100;
    significanceLevel = 0.05;
    warmUpTime = 3;
    samplingMode = 'auto';
    quickMode = false;

    constructor(opts) {
        Object.assign(this, opts)
    }
}

export class Reporter extends Report {
    constructor(...reporters) {
        super();
        this.reporters = reporters;
    }

    benchmarkStart(id, ctx) {
        this.reporters.forEach(reporter => reporter.benchmarkStart(id, ctx))
    }

    analysis(id, context) {
        this.reporters.forEach(reporter => reporter.analysis(id, context))
    }

    warmup(id, context, wu) {
        this.reporters.forEach(reporter => reporter.warmup(id, context, wu))
    }

    measurementStart(id, context, sampleCount, estimateNs, iterCount) {
        this.reporters.forEach(reporter => reporter.measurementStart(id, context, sampleCount, estimateNs, iterCount))
    }

    measurementComplete(id, context, measurements, formatter) {
        this.reporters.forEach(reporter => reporter.measurementComplete(id, context, measurements, formatter))
    }
}

class WallTime {
    start() {
        return performance.now();
    }

    end(begin) {
        return performance.now() - begin;
    }

    scaleValues(ns, values) {
        let factor, unit;
        if (ns < 10 ** 0) {
            [factor, unit] = [10 ** 3, "ps"];
        } else if (ns < 10 ** 3) {
            [factor, unit] = [10 ** 0, "ns"];
        } else if (ns < 10 ** 6) {
            [factor, unit] = [10 ** -3, "µs"];
        } else if (ns < 10 ** 9) {
            [factor, unit] = [10 ** -6, "ms"];
        } else {
            [factor, unit] = [10 ** -9, "s"];
        }

        values.forEach((v, i, arr) => arr[i] = v * factor)

        return unit;
    }

    format(value) {
        let values = [value];
        let unit = this.scaleValues(value, values);
        return `${short(values[0]).padEnd(6)} ${unit}`
    }
}

export class Criterion {
    queue = [];
    concurrency = 1;
    running = 0;
    report = new Reporter(new CliReport, new HtmlReport);
    filter = null;
    outputDirectory = 'criterion';
    measurement = new WallTime;

    constructor(config) {
        this.config = Object.assign(new CriterionConfig, config);
    }

    benchmarkGroup(name) {
        return new BenchmarkGroup(this, name);
    }

    async runTask(task) {
        if (this.running >= this.concurrency) {
            await new Promise(resolve => this.queue.push(resolve));
        }
        this.running++;
        try {
            await task();
        } finally {
            this.running--;
            if (this.queue.length > 0) {
                this.queue.shift()();
            }
        }
    }

    submit(task) {
        return this.runTask(task);
    }
}

export function blackbox(x) {
    globalThis.sink = x;
    return x
}
