#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {BenchmarkId, group,} from "./index.js";
import {renderTemplate} from "./templates.js";
import {Sample, Slope} from "./analysis.js";
import child_process from "node:child_process";
import {formatMeasurement, HtmlBenchmarkGroup, scaleValues} from "./report.js";

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
    return 1 / Math.sqrt(Math.exp(x ** 2) * 2 * Math.PI);
}

function silverman(sample) {
    let factor = 4 / 3;
    let exponent = 1 / 5;
    let n = sample.numbers.length;
    let sigma = sample.stdDev();

    return sigma * (factor / n) ** exponent;
}

function sweepAndEstimate(sample, npoints, range, point_to_estimate) {
    let xMin = Math.min(...sample.numbers);
    let xMax = Math.max(...sample.numbers);

    let kde = new Kde(sample, silverman(sample));
    let h = kde.bandwidth;
    let [start, end] = range ? range : [xMin - 3 * h, xMax + 3 * h];
    let xs = [];

    let step_size = (end - start) / (npoints - 1);
    for (let i = 0; i < npoints; i++) {
        xs.push(start + step_size * i);
    }
    let ys = xs.map((x) => kde.estimate(x));
    let point_estimate = kde.estimate(point_to_estimate);
    return [xs, ys, point_estimate];
}

class PlotContext {
    constructor(id, outputDirectory, size, isThumbnail) {
        this.id = id;
        this.outputDirectory = outputDirectory;
        this.size = size;
        this.isThumbnail = isThumbnail;
    }
}

class PlotData {
    constructor(measurements) {
        this.measurements = measurements;
    }
}

class GnuPlotter {
    pdf(ctx, data) {
        let size = ctx.size;
        ctx.isThumbnail
            ? pdfSmall(ctx.id, ctx.outputDirectory, data.measurements, size)
            : pdf(ctx.id, ctx.outputDirectory, data.measurements, size);
    }

    regression(ctx, data) {
        ctx.isThumbnail
            ? regressionSmall(ctx.id, ctx.outputDirectory, data.measurements, ctx.size)
            : regression(ctx.id, ctx.outputDirectory, data.measurements, ctx.size);
    }

    violin(ctx, data) {
        violin(ctx.id, ctx.outputDirectory, data, ctx.size)
    }
}

function pdfSmall(id, outputDirectory, measurements, size) {
    let iterCounts = measurements.data.xs;
    let maxIters = Math.max(...iterCounts);
    let exponent = 3 * Math.floor(Math.log10(maxIters) / 3);
    let yLabel = exponent ? `Iterations (x 10^${exponent})` : "Iterations";

    let avg_times = measurements.avgTimes;
    let [lost, lomt, himt, hist] = measurements.avgTimes.fences;
    let scaled_numbers = [...avg_times.sample.numbers];
    let typical = Math.max(...scaled_numbers);
    let unit = scaleValues(typical, scaled_numbers);
    let scaled_avg_times = new Sample(scaled_numbers);
    let mean = scaled_avg_times.mean();
    let [xs, ys, mean_y] = sweepAndEstimate(
        scaled_avg_times,
        500,
        null,
        mean,
    );

    let reportDir = path.join(outputDirectory, id.directoryName, "report");
    fs.mkdirSync(reportDir, {recursive: true});
    let figurePath = path.join(
        reportDir,
        "pdf_small.svg",
    );

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
`;

    for (let [x, y] of xs.map((x, i) => [x, ys[i]])) {
        script += `${x} ${y} 0\n`;
    }
    script += "e\n";
    script += `${mean} ${mean_y}\n`;
    script += `${mean} 0\n`;
    script += "e\n";

    gnuplot(script);
}

function confidenceInterval(percentiles, confidenceLevel) {
    if (confidenceLevel <= 0 || confidenceLevel >= 1) {
        throw "unexpected confidence level";
    }

    return [
        percentiles.at(50 * (1 - confidenceLevel)),
        percentiles.at(50 * (1 + confidenceLevel)),
    ];
}

function regression(id, outputDirectory, measurements, size) {
    let slopeEstimate = measurements.absoluteEstimates.slope;
    let slopeDist = measurements.distributions.slope;
    let [lb, ub] = confidenceInterval(
        new Sample(slopeDist.numbers).percentiles(),
        slopeEstimate.confidenceInterval.confidenceLevel,
    );

    let data = measurements.data;

    let [maxIters, typical] = [Math.max(...data.xs), Math.max(...data.ys)];
    let scaled_numbers = [...data.ys];
    let unit = scaleValues(typical, scaled_numbers);

    let point_estimate = Slope.fit(measurements.data);

    let scaled_points = [
        point_estimate * maxIters,
        lb * maxIters,
        ub * maxIters,
    ];

    scaleValues(typical, scaled_points);

    let [point, lb2, ub2] = scaled_points;

    let exponent = 3 * Math.floor(Math.log10(maxIters) / 3);
    let x_scale = 10 ** -exponent;

    let x_label =
        exponent === 0 ? "Iterations" : `Iterations (x 10^${exponent})`;

    let figurePath = path.join(
        outputDirectory,
        id.directoryName,
        "report",
        "regression.svg",
    );

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
    script += "e\n";

    script += `0 0\n`;
    script += `${maxIters} ${point}\n`;
    script += "e\n";

    gnuplot(script);
}

function regressionSmall(id, outputDirectory, measurements, size) {
    let slopeEstimate = measurements.absoluteEstimates.slope;
    let slopeDist = measurements.distributions.slope;
    let [lb, ub] = confidenceInterval(
        new Sample(slopeDist.numbers).percentiles(),
        slopeEstimate.confidenceInterval.confidenceLevel,
    );
    let data = measurements.data;
    let [max_iters, typical] = [Math.max(...data.xs), Math.max(...data.ys)];
    let scaled_numbers = [...data.ys];
    let unit = scaleValues(typical, scaled_numbers);
    let point_estimate = Slope.fit(measurements.data);
    let scaled_points = [
        point_estimate * max_iters,
        lb * max_iters,
        ub * max_iters,
    ];
    scaleValues(typical, scaled_points);
    let [point, lb2, ub2] = scaled_points;
    let exponent = 3 * Math.floor(Math.log10(max_iters) / 3);
    let x_scale = 10 ** -exponent;
    let x_label =
        exponent === 0 ? "Iterations" : `Iterations (x 10^${exponent})`;

    let figurePath = path.join(
        outputDirectory,
        id.directoryName,
        "report",
        "regression_small.svg",
    );

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

    for (let [x, y] of data.xs.map((x, i) => [
        x * x_scale,
        scaled_numbers[i],
    ])) {
        script += `${x} ${y} 0\n`;
    }
    script += "e\n";

    script += `0 0\n`;
    script += `${max_iters * x_scale} ${point}\n`;
    script += "e\n";

    gnuplot(script);
}

function violin(id, outputDirectory, measurements) {
    let allCurves = Object.values(measurements.measurements).map(x => new Sample(x.avgTimes.sample.numbers));
    console.log(allCurves);

// let path = PathBuf::from(&path);
//     let all_curves_vec = all_curves.iter().rev().cloned().collect::<Vec<_>>();
//     let all_curves: &[&(&BenchmarkId, Vec<f64>)] = &all_curves_vec;
//
    let kdes = allCurves.map(avgTimes => {
        console.log('sweepAndEstimate', avgTimes)
        let [xs, ys] = sweepAndEstimate(avgTimes, 500, null, avgTimes[0]);
        let yMax = Math.max(...ys);
        let ysNormalized = ys.map(y => y / yMax);
        return [xs, ysNormalized];
    });

    let xs = kdes.flatMap(([xs, _]) => xs).filter(x => x > 0.)


//     let kdes = all_curves
//         .iter()
//         .map(|&(_, sample)| {
//             let (x, mut y) = kde::sweep(Sample::new(sample), KDE_POINTS, None);
//             let y_max = Sample::new(&y).max();
//             for y in y.iter_mut() {
//                 *y /= y_max;
//             }
//
//             (x, y)
//         })
//         .collect::<Vec<_>>();


    let [min, max] = [xs[0], xs[0]];
    for (let e of xs) {
        if (e < min) {
            min = e;
        } else if (e > max) {
            max = e;
        }
    }

    let one = [1.0];
    let unit = scaleValues((min + max) / 2, one);

    console.log(outputDirectory, id, id.directoryName)
    let figurePath = path.join(
        outputDirectory,
        id,
        "report",
        "violin.svg",
    );

    let plotCommands = []
    for (let i = 0; i < kdes.length; i++) {
        let plotCommand = "'-' using 1:2:3 with filledcurves fillstyle noborder lc rgb '#1f78b4' ";
        plotCommand += i === 0 ? "title 'PDF'" : "notitle";
        plotCommands.push(plotCommand);
    }
    let plotCommand = 'plot ' + plotCommands.join(', ')
    console.log('plotCommand', plotCommand)

    let funcs = Object.keys(measurements.measurements);
    console.log('funcs', funcs);
    let yTics = [];
    for(let i = 0; i < funcs.length; i++) {
        yTics.push(`'${funcs[i]}' ${i + 0.5}`);
    }

    let script = `set output '${figurePath}'
set title 'Fibonacci: Violin plot'
set xtics nomirror
set xlabel 'Average time (${unit})'
set xrange [0:${max * one[0]}]
set grid xtics
set ytics nomirror (${yTics.join(', ')})
set ylabel 'Benchmark'
set yrange [0:${funcs.length}]
set terminal svg dynamic dashed size 1280, ${200 + 25 * funcs.length} font 'Helvetica'
unset bars
${plotCommand}\n`;

    for (let i = 0; i < kdes.length; i++) {
        let i2 = i + 0.5;
        let [xs, ys] = kdes[i];
        let ys1 = ys.map(y => i2 + y * .45);
        let ys2 = ys.map(y => i2 - y * .45);
        let xScaled = xs.map(x => x * one[0]);
        for (let [x, y1, y2] of xScaled.map((x, i) => [x, ys1[i], ys2[i]])) {
            script += `${x} ${y1} ${y2}\n`;
        }
        script += 'e\n';
    }

    gnuplot(script);
}

function gnuplot(script) {
    let result = child_process.spawnSync("gnuplot", [], {input: script});
    if (result.error) {
        console.error("Could not run `gnuplot`. Is it installed?", result.error);
        process.exit(1);
    } else if (result.status !== 0) {
        console.error("Failed to render plots");
        if (process.env.CRITERION_DEBUG) {
            console.log('======================')
            console.log('[DEBUG] Gnuplot script')
            console.log('======================')
            console.log(script)
            console.log('======================')
            console.log("[DEBUG] Gnuplot stdout");
            console.log('======================')
            console.log(result.stdout.toString());
            console.log('======================')
            console.log("[DEBUG] Gnuplot stderr");
            console.log('======================')
            console.error(result.stderr.toString());
            console.log('======================')
        }
        console.error("Gnuplot exit code:", result.status);
        process.exit(1)
    }
}

function pdf(id, context, measurements, size) {
    throw "WIP";

    let iterCounts = measurements.data.xs;
    let maxIters = Math.max(...iterCounts);
    let exponent = 3 * Math.floor(Math.log10(maxIters) / 3);
    let yLabel = exponent ? `Iterations (x 10^${exponent})` : "Iterations";

    let avg_times = measurements.avgTimes;
    let [lost, lomt, himt, hist] = measurements.avgTimes.fences;
    let scaled_numbers = [...avg_times.sample.numbers];
    let typical = Math.max(...scaled_numbers);
    let unit = scaleValues(typical, scaled_numbers);
    let scaled_avg_times = new Sample(scaled_numbers);
    let mean = scaled_avg_times.mean();
    let [xs, ys, mean_y] = sweepAndEstimate(
        scaled_avg_times,
        500,
        null,
        mean,
    );
    let figurePath = path.join(
        context.outputDirectory,
        id.directoryName,
        "report",
        "pdf.svg",
    );

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
`;

    for (let [x, y] of xs.map((x, i) => [x, ys[i]])) {
        script += `${x} ${y} 0\n`;
    }
    script += "e\n";

    // mean
    script += `${mean} ${mean_y}\n`;
    script += `${mean} 0\n`;
    script += "e\n";

    // clean sample
    for (let [n, x, y] of avg_times.sample.numbers.map((x, i) => [
        x,
        scaled_avg_times.numbers[i],
        iterCounts[i],
    ])) {
        if (n < lost) {
            // los += 1;
        } else if (n > hist) {
            // his += 1;
        } else if (n < lomt) {
            // lom += 1;
        } else if (n > himt) {
            // him += 1;
        } else {
            script += `${x} ${y}\n`;
        }
    }
    script += "e\n";

    // q1

    // q3

    // console.log(script);
    gnuplot(script);
}

function generate_plots(id, outputDirectory, measurements) {
    let plotter = new GnuPlotter();

    let plot_ctx = new PlotContext(id, outputDirectory, null, false);

    let plot_data = new PlotData(measurements);

    let plot_ctx_small = new PlotContext(id, outputDirectory, [450, 300], true);

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

function generatePlotsAndReport(
    measurements,
    id,
    outputDirectory,
) {
    console.log('generating plots and report for', id.title);
    let typical_estimate =
        measurements.absoluteEstimates.slope ??
        measurements.absoluteEstimates.mean;

    let time_interval = (est) => {
        let {lowerBound, upperBound} = est.confidenceInterval;
        return new HtmlConfidenceInterval(
            formatMeasurement(lowerBound),
            formatMeasurement(est.pointEstimate),
            formatMeasurement(upperBound),
        );
    };

    let data = measurements.data;

    generate_plots(id, outputDirectory, measurements);

    let additional_plots = [
        // new Plot("Typical", "typical.svg"),
        // new Plot("Mean", "mean.svg"),
        // new Plot("Std. Dev.", "SD.svg"),
        // new Plot("Median", "median.svg"),
        // new Plot("MAD", "MAD.svg"),
    ];
    if (measurements.absoluteEstimates.slope) {
        // additional_plots.push(new Plot("Slope", "slope.svg"));
    }

    let context = {
        title: id.title,
        confidence:
            typical_estimate.confidenceInterval.confidenceLevel.toFixed(2),
        thumbnail_width: 450,
        thumbnail_height: 300,

        slope: measurements.absoluteEstimates.slope
            ? time_interval(measurements.absoluteEstimates.slope)
            : null,
        mean: time_interval(measurements.absoluteEstimates.mean),
        median: time_interval(measurements.absoluteEstimates.median),
        mad: time_interval(measurements.absoluteEstimates.medianAbsDev),
        std_dev: time_interval(measurements.absoluteEstimates.stdDev),
        r2: new HtmlConfidenceInterval(
            Slope.rSquared(
                typical_estimate.confidenceInterval.lowerBound,
                data,
            ).toFixed(7),
            Slope.rSquared(typical_estimate.pointEstimate, data).toFixed(7),
            Slope.rSquared(
                typical_estimate.confidenceInterval.upperBound,
                data,
            ).toFixed(7),
        ),
        additional_plots,
        comparison: null,
    };

    let reportDir = path.join(outputDirectory, id.directoryName, "report");
    fs.mkdirSync(reportDir, {recursive: true});
    let report_path = path.join(reportDir, "index.html");
    let output = renderTemplate("benchmark_report", context);
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
            } else if (stats.isFile() && file === "benchmark.json") {
                callback(filepath);
            }
        });
    };
    let benchmarks = [];
    walkSync(directory, (file) => {
        benchmarks.push(file);
    });
    return benchmarks;
}

function generateGroupReport(group, outputDirectory) {
    // console.log('generateGroupReport', JSON.stringify(group, undefined, 4));

    let groupId = group.groupReport.name;
    let plot_ctx = new PlotContext(groupId, outputDirectory, null, false);
    let reportDir = path.join(outputDirectory, groupId, 'report');
    fs.mkdirSync(reportDir, {recursive: true})

    let plotter = new GnuPlotter;
    plotter.violin(plot_ctx, group)


//         self.plotter.borrow_mut().violin(plot_ctx, formatter, data);
//
//         let value_types: Vec<_> = data.iter().map(|&&(id, _)| id.value_type()).collect();
//         let mut line_path = None;
//
//         if value_types.iter().all(|x| x == &value_types[0]) {
//             if let Some(value_type) = value_types[0] {
//                 let values: Vec<_> = data.iter().map(|&&(id, _)| id.as_number()).collect();
//                 if values.iter().any(|x| x != &values[0]) {
//                     self.plotter
//                         .borrow_mut()
//                         .line_comparison(plot_ctx, formatter, data, value_type);
//                     line_path = Some(plot_ctx.line_comparison_path());
//                 }
//             }
//         }
//
//         let path_prefix = if full_summary { "../.." } else { "../../.." };
//         let benchmarks = data
//             .iter()
//             .map(|&&(id, _)| {
//                 IndividualBenchmark::from_id(&report_context.output_directory, path_prefix, id)
//             })
//             .collect();
//
    let context = {
        group_id: group.groupReport.name,
        groupReport: group.groupReport,

        thumbnail_width: 450,
        thumbnail_height: 300,

        // violin_plot: Some(plot_ctx.violin_path().to_string_lossy().into_owned()),
        // line_chart: line_path.map(|p| p.to_string_lossy().into_owned()),

        benchmarks: group.functionLinks,
    };

    let report_path = path.join(reportDir, 'index.html');
    let report = renderTemplate('summary_report', context);
    fs.writeFileSync(report_path, report)
}

async function main() {
    if (process.argv.length !== 3 || !fs.existsSync(process.argv[2])) {
        console.error("usage: npx criterion-report path_to_criterion_folder");
        process.exit(1);
    }
    let outputDir = process.argv[2];

    let benchmarkFiles = listBenchmarks(outputDir);
    console.log(`Found ${benchmarkFiles.length} benchmarks.`);
    let benchmarks = [];
    for (let benchmark of benchmarkFiles) {
        let blob = fs.readFileSync(benchmark);
        let {id, measurements} = JSON.parse(blob);
        let {groupId, functionId, valueString, throughput} = id;

        let internalBenchmarkId = new BenchmarkId(
            groupId, functionId, measurements,
        );
        generatePlotsAndReport(measurements, internalBenchmarkId, outputDir);
        benchmarks.push(internalBenchmarkId);
    }

    benchmarks.sort((a, b) => a.fullId.localeCompare(b.fullId));
    let idGroups = {};
    for (let benchmark of benchmarks) {
        let group = idGroups[benchmark.groupId] || [];
        group.push(benchmark);
        idGroups[benchmark.groupId] = group;
    }

    let groups = Object.values(idGroups).map((group) =>
        HtmlBenchmarkGroup.fromGroup(outputDir, group),
    );
    groups.sort((a, b) => a.groupReport.name.localeCompare(b.groupReport.name));

    for (let group of groups) {
        generateGroupReport(group, outputDir);
    }

    let reportDir = path.join(outputDir, "report");
    fs.mkdirSync(reportDir, {recursive: true});
    let reportPath = path.join(reportDir, "index.html");

    fs.writeFileSync(
        reportPath,
        renderTemplate("index", {
            groups,
        }),
    );

    console.log("Wrote", reportPath);
}

main();
