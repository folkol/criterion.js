import fs from 'node:fs';
import path from 'node:path';
import {formatMeasurement, HtmlBenchmarkGroup, InternalBenchmarkId, scaleValues, short} from "./index.mjs";
import {renderTemplate} from "./templates.mjs";
import {Sample, Slope} from "./analysis.js";
import child_process from 'node:child_process';


class HtmlConfidenceInterval {
    constructor(lower, point, upper) {
        this.lower = lower;
        this.point = point;
        this.upper = upper;
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


class Plot {
    constructor(name, url) {
        this.name = name;
        this.url = url;
    }
}

class PlotContext {
    constructor(id,
                outputDirectory,
                size,
                is_thumbnail) {
        this.id = id;
        this.outputDirectory = outputDirectory;
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

class GnuPlotter {
    process_list = []

    pdf(ctx, data) {
        let size = ctx.size;
        this.process_list.push(
            ctx.is_thumbnail ?
                pdf_small(ctx.id, ctx.outputDirectory, data.formatter, data.measurements, size)
                :
                pdf(ctx.id, ctx.outputDirectory, data.formatter, data.measurements, size)
        );
    }

    regression(ctx, data) {
        this.process_list.push(ctx.is_thumbnail ?
            regression_small(ctx.id, ctx.outputDirectory, data.formatter, data.measurements, ctx.size)
            :
            regression(ctx.id, ctx.outputDirectory, data.formatter, data.measurements, ctx.size));
    }
}

function pdf_small(id, outputDirectory, formatter, measurements, size) {
    let iterCounts = measurements.data.xs;
    let maxIters = Math.max(...iterCounts);
    let exponent = 3 * Math.floor(Math.log10(maxIters) / 3)
    let yLabel = exponent ? `Iterations (x 10^${exponent})` : 'Iterations';

    let avg_times = measurements.avgTimes;
    let [lost, lomt, himt, hist] = measurements.avgTimes.fences;
    let scaled_numbers = [...avg_times.sample.numbers];
    let typical = Math.max(...scaled_numbers);
    let unit = scaleValues(typical, scaled_numbers)
    let scaled_avg_times = new Sample(scaled_numbers);
    let mean = scaled_avg_times.mean();
    let [xs, ys, mean_y] = sweep_and_estimate(scaled_avg_times, 500, null, mean);
    let figurePath = path.join(outputDirectory, id.directoryName, 'report', 'pdf_small.svg');

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



function regression(id, outputDirectory, formatter, measurements, size) {
    let slopeEstimate = measurements.absoluteEstimates.slope;
    let slopeDist = measurements.distributions.slope;
    let [lb, ub] = confidenceInterval(new Sample(slopeDist.numbers).percentiles(), slopeEstimate.confidence_interval.confidence_level);

    let data = measurements.data;

    let [max_iters, typical] = [Math.max(...data.xs), Math.max(...data.ys)];
    let scaled_numbers = [...data.ys];
    let unit = scaleValues(typical, scaled_numbers);

    let point_estimate = Slope.fit(measurements.data);

    let scaled_points = [point_estimate * max_iters, lb * max_iters, ub * max_iters];

    scaleValues(typical, scaled_points);

    let [point, lb2, ub2] = scaled_points;

    let exponent = 3 * Math.floor(Math.log10(max_iters) / 3)
    let x_scale = 10 ** -exponent;

    let x_label = exponent === 0 ? "Iterations" : `Iterations (x 10^${exponent})`

    let figurePath = path.join(outputDirectory, id.directoryName, 'report', 'regression.svg');

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

function regression_small(id, outputDirectory, formatter, measurements, size) {
    let slopeEstimate = measurements.absoluteEstimates.slope;
    let slopeDist = measurements.distributions.slope;
    let [lb, ub] = confidenceInterval(new Sample(slopeDist.numbers).percentiles(), slopeEstimate.confidence_interval.confidence_level);
    let data = measurements.data;
    let [max_iters, typical] = [Math.max(...data.xs), Math.max(...data.ys)];
    let scaled_numbers = [...data.ys];
    let unit = scaleValues(typical, scaled_numbers);
    let point_estimate = Slope.fit(measurements.data);
    let scaled_points = [point_estimate * max_iters, lb * max_iters, ub * max_iters];
    scaleValues(typical, scaled_points);
    let [point, lb2, ub2] = scaled_points;
    let exponent = 3 * Math.floor(Math.log10(max_iters) / 3)
    let x_scale = 10 ** -exponent;
    let x_label = exponent === 0 ? "Iterations" : `Iterations (x 10^${exponent})`

    let figurePath = path.join(outputDirectory, id.directoryName, 'report', 'regression_small.svg');

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
    let unit = scaleValues(typical, scaled_numbers)
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

function generate_plots(id, outputDirectory, formatter, measurements) {

    let plotter = new GnuPlotter;

    let plot_ctx = new PlotContext(
        id,
        outputDirectory,
        null,
        false,
    );


    let plot_data = new PlotData(
        measurements,
        formatter,
        null);


    let plot_ctx_small = new PlotContext(
        id,
        outputDirectory,
        [450, 300],
        true,
    )

    plotter.pdf(plot_ctx_small, plot_data);
    // plotter.pdf(plot_ctx, plot_data);

    if (measurements.absoluteEstimates.slope) {
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


function generate_plots_and_report(_measurements, _formatter, _id, outputDirectory) {
    let typical_estimate = _measurements.absoluteEstimates.slope ?? _measurements.absoluteEstimates.mean;


    let time_interval = est =>
        new HtmlConfidenceInterval(formatMeasurement(est.confidence_interval.lower_bound),
            formatMeasurement(est.point_estimate),
            formatMeasurement(est.confidence_interval.upper_bound));


    let data = _measurements.data;

    generate_plots(_id, outputDirectory, _formatter, _measurements)

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
        outputDirectory,
        _id.directoryName,
        "report",
        "index.html");

    let output = renderTemplate('benchmark_report', context);
    fs.writeFileSync(report_path, output);
}


function listBenchmarks(directory) {
    const walkSync = (dir, callback) => {
        const files = fs.readdirSync(dir);
        files.forEach((file) => {
            let filepath = path.join(dir, file);
            const stats = fs.statSync(filepath);
            if (stats.isDirectory()) {
                walkSync(filepath, callback);
            } else if (stats.isFile() && file === 'benchmark.json') {
                let measurements = fs.readFileSync(path.join(dir, 'measurements.json'));
                let blob = fs.readFileSync(filepath);
                let {groupId, functionId, valueString, throughput} = JSON.parse(blob);
                let id = new InternalBenchmarkId(groupId, functionId, valueString, throughput);
                generate_plots_and_report(JSON.parse(measurements), x => {
                        console.error('Unexpected use of dummy formatter')
                        throw 'should not be used'
                    }
                    , id
                    , directory);
                callback(filepath);
            }
        });
    };
    let benchmarks = [];
    walkSync(directory, file => {
        let blob = fs.readFileSync(file);
        let {groupId, functionId, valueString, throughput} = JSON.parse(blob);
        let id = new InternalBenchmarkId(groupId, functionId, valueString, throughput);
        return benchmarks.push(id);
    })
    return benchmarks;
}


async function main() {
    if (process.argv.length !== 3 || !fs.existsSync(process.argv[2])) {
        console.error('usage: generate-report path_to_criterion_folder')
        process.exit(1)
    }
    let outputDir = process.argv[2];
    let benchmarks = listBenchmarks(outputDir);
    console.log(`Found ${benchmarks.length} benchmark reports.`)
    benchmarks.sort((a, b) => a.fullId.localeCompare(b.fullId));
    let idGroups = {};
    for (let benchmark of benchmarks) {
        let group = idGroups[benchmark.groupId] || [];
        group.push(benchmark);
        idGroups[benchmark.groupId] = group;
    }

    let groups = Object.values(idGroups).map(group => HtmlBenchmarkGroup.fromGroup(outputDir, group));
    groups.sort((a, b) => a.groupReport.name.localeCompare(b.groupReport.name));

    let reportDir = path.join(outputDir, 'report');
    fs.mkdirSync(reportDir, {recursive: true});
    let reportPath = path.join(reportDir, 'index.html')

    fs.writeFileSync(reportPath, renderTemplate('index', {groups, title: 'my report', content: 'wat?'}));

    console.log('Wrote', reportPath);
}

main()
