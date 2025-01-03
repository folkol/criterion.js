#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {BenchmarkId} from "./index.js";
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

function plotPdfSmall(id, outputDirectory, measurements) {
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

function plotAdditional(id, outputDirectory, statistic, filename, distribution, estimate) {
    let ci = estimate.confidenceInterval;
    let typical = ci.upperBound;
    let ci_values = [ci.lowerBound, ci.upperBound, estimate.pointEstimate];

    let unit = scaleValues(typical, ci_values);
    let [lb, ub, point] = [ci_values[0], ci_values[1], ci_values[2]];

    let start = lb - (ub - lb) / 9.;
    let end = ub + (ub - lb) / 9.;
    let scaled_xs = [...distribution.numbers];
    scaleValues(typical, scaled_xs);
    let scaled_xs_sample = new Sample(scaled_xs);

    let [kde_xs, ys] = sweepAndEstimate(scaled_xs_sample, 500, [start, end]);

    // interpolate between two points of the KDE sweep to find the Y position at the point estimate.
    let n_point = kde_xs.length - 1;
    for (let i = 0; i < kde_xs.length; i++) {
        if (kde_xs[i] >= point) {
            n_point = Math.max(i, 1);
            break
        }
    }

    let slope = (ys[n_point] - ys[n_point - 1]) / (kde_xs[n_point] - kde_xs[n_point - 1]);
    let y_point = ys[n_point - 1] + (slope * (point - kde_xs[n_point - 1]));

    let start2 = kde_xs.findIndex(x => x >= lb);
    let end2 = kde_xs.findLastIndex(x => x <= ub);

    let len = end2 - start2;

    let kde_xs_sample = new Sample(kde_xs);

    let title = `${id.title}: ${statistic}`;
    let [xMin, xMax] = [Math.min(...kde_xs_sample.numbers), Math.max(...kde_xs_sample.numbers)];

    let reportDir = path.join(outputDirectory, id.directoryName, "report");
    fs.mkdirSync(reportDir, {recursive: true});
    let figurePath = path.join(
        reportDir,
        filename,
    );

    let script = `set output '${figurePath}'
set title '${title}'
set xtics nomirror
set xlabel 'Average time (${unit})'
set xrange [${xMin}:${xMax}]
set ytics nomirror
set ylabel 'Density (a.u.)'
set key on outside top right Left reverse
set terminal svg dynamic dashed size 1280, 720 font 'Helvetica'
unset bars
plot '-' using 1:2 with lines lt 1 lw 2 lc rgb '#1f78b4' title 'Bootstrap distribution', \
     '-' using 1:2:3 with filledcurves fillstyle solid 0.25 noborder lc rgb '#1f78b4' title 'Confidence interval', \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#1f78b4' title 'Point estimate'
    `;

    for (let [x, y] of kde_xs.map((x, i) => [x, ys[i]])) {
        script += `${x} ${y}\n`;
    }
    script += "e\n";

    for (let [x, y] of kde_xs.slice(start2, start2 + len).map((x, i) => [x, ys.slice(start2)[i]])) {
        script += `${x} ${y} 0\n`;
    }
    script += "e\n";

    script += `${point} 0\n`
    script += `${point} ${y_point}\n`
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

function plotRegression(id, outputDirectory, measurements, size) {
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
        "regression.svg",
    );

    let script = `set output '${figurePath}'
set title '${id.title}'
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

    script += `0 0 0\n`;
    script += `${max_iters * x_scale} ${lb2} ${ub2}\n`;
    script += "e\n";

    gnuplot(script);
}

function plotRegressionSmall(id, outputDirectory, measurements) {
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

    script += `0 0 0\n`;
    script += `${max_iters * x_scale} ${lb2} ${ub2}\n`;
    script += "e\n";

    gnuplot(script);
}

function plotViolin(id, outputDirectory, measurements) {
    let allCurves = Object.values(measurements.measurements).map(x => new Sample(x.avgTimes.sample.numbers));

    let kdes = allCurves.map(avgTimes => {
        let [xs, ys] = sweepAndEstimate(avgTimes, 500, null, avgTimes[0]);
        let yMax = Math.max(...ys);
        let ysNormalized = ys.map(y => y / yMax);
        return [xs, ysNormalized];
    });

    let xs = kdes.flatMap(([xs, _]) => xs).filter(x => x > 0.)
    let [min, max] = [xs[0], xs[0]];
    for (let e of xs) {
        if (e < min) {
            min = e;
        } else if (e > max) {
            max = e;
        }
    }

    let scale = [1.0];
    let unit = scaleValues((min + max) / 2, scale);

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

    let funcs = Object.keys(measurements.measurements);
    let yTics = [];
    for (let i = 0; i < funcs.length; i++) {
        yTics.push(`'${funcs[i]}' ${i + 0.5}`);
    }

    let script = `set output '${figurePath}'
set title 'Fibonacci: Violin plot'
set xtics nomirror
set xlabel 'Average time (${unit})'
set xrange [0:${max * scale[0]}]
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
        let xScaled = xs.map(x => x * scale[0]);
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
            console.error('======================')
            console.error("[DEBUG] Gnuplot stderr");
            console.error('======================')
            console.error(result.stderr.toString());
            console.error('======================')
        }
        console.error("Gnuplot exit code:", result.status);
        process.exit(1)
    }
}

function plotPdf(id, outputDirectory, measurements) {
    let iterCounts = measurements.data.xs;
    let maxIters = Math.max(...iterCounts);
    let exponent = 3 * Math.floor(Math.log10(maxIters) / 3);
    let yLabel = exponent ? `Iterations (x 10^${exponent})` : "Iterations";

    let avg_times = measurements.avgTimes;
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
        "pdf.svg",
    );

    let min_x = Math.min(...xs);
    let max_x = Math.max(...xs);
    let max_y = Math.max(...ys) * 1.1;

    let script = `set output '${figurePath}'
set title '${id.title}'
set xtics nomirror
set xlabel 'Average time (${unit})'
set xrange [${min_x}:${max_x}]
show xrange
set ytics nomirror
set ylabel 'Iterations (x 10^${exponent})'
set yrange [0:${max_y}]
set y2tics nomirror
set key on outside top right Left reverse
set terminal svg dynamic dashed size 1280, 720 font 'Helvetica'
unset bars
plot '-' using 1:2:3 axes x1y2 with filledcurves fillstyle solid 0.25 noborder lc rgb '#1f78b4' title 'PDF', \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#1f78b4' title 'Mean', \
     '-' using 1:2 with points lt 1 lc rgb '#1f78b4' pt 7 ps 0.75 title '"Clean" sample', \
     '-' using 1:2 with points lt 1 lc rgb '#ff7f00' pt 7 ps 0.75 title 'Mild Outliers', \
     '-' using 1:2 with points lt 1 lc rgb '#e31a1c' pt 7 ps 0.75 title 'Severe Outliers', \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#ff7f00' notitle, \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#ff7f00' notitle, \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#e31a1c' notitle, \
     '-' using 1:2 with lines lt 2 lw 2 lc rgb '#e31a1c' notitle
`;

    for (let [x, y] of xs.map((x, i) => [x, ys[i]])) {
        script += `${x} ${y} 0\n`;
    }
    script += "e\n";

    script += `${mean} ${max_y}\n`;
    script += `${mean} 0\n`;
    script += "e\n";

    let clean = [];
    let mildOutliers = [];
    let severeOutliers = [];

    let [lost, lomt, himt, hist] = measurements.avgTimes.fences;
    for (let [n, x, y] of avg_times.sample.numbers.map((x, i) => [
        x,
        scaled_avg_times.numbers[i],
        ys[i]
    ])) {
        if (n < lost) {
            severeOutliers.push([x, y]);
        } else if (n > hist) {
            severeOutliers.push([x, y]);
        } else if (n < lomt) {
            mildOutliers.push([x, y]);
        } else if (n > himt) {
            mildOutliers.push([x, y]);
        } else {
            clean.push([x, y]);
        }
    }
    for(let [x, y] of clean) {
        script += `${x} ${y}\n`
    }
    script += "e\n";
    for(let [x, y] of mildOutliers) {
        script += `${x} ${y}\n`
    }
    script += "e\n";
    for(let [x, y] of severeOutliers) {
        script += `${x} ${y}\n`
    }
    script += "e\n";

    let scaledFences = [...measurements.avgTimes.fences];
    scaleValues(typical, scaledFences)
    let [scaledLost, scaledLomt, scaledHimt, scaledHist] = scaledFences

    // inner fences
    script += `${scaledLomt} ${max_y}\n`;
    script += `${scaledLomt} 0\n`;
    script += "e\n";
    script += `${scaledHimt} ${max_y}\n`;
    script += `${scaledHimt} 0\n`;
    script += "e\n";

    // outer fences
    script += `${scaledLost} ${max_y}\n`;
    script += `${scaledLost} 0\n`;
    script += "e\n";
    script += `${scaledHist} ${max_y}\n`;
    script += `${scaledHist} 0\n`;
    script += "e\n";

    gnuplot(script);
}

function generate_plots(id, outputDirectory, measurements) {
    plotPdfSmall(id, outputDirectory, measurements)
    plotPdf(id, outputDirectory, measurements)

    if (measurements.absoluteEstimates.slope) {
        plotRegressionSmall(id, outputDirectory, measurements)
        plotRegression(id, outputDirectory, measurements)
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

    plotAdditional(id, outputDirectory, 'Mean', 'mean.svg', measurements.distributions.mean, measurements.absoluteEstimates.mean);
    plotAdditional(id, outputDirectory, 'Median', 'median.svg', measurements.distributions.median, measurements.absoluteEstimates.median);
    plotAdditional(id, outputDirectory, 'Std. Dev.', 'stdDev.svg', measurements.distributions.stdDev, measurements.absoluteEstimates.stdDev);
    plotAdditional(id, outputDirectory, 'MAD', 'mad.svg', measurements.distributions.medianAbsDev, measurements.absoluteEstimates.medianAbsDev);
    let additional_plots = [
        {url: 'mean.svg', name: 'Mean'},
        {url: 'median.svg', name: 'Median'},
        {url: 'stdDev.svg', name: 'Std. Dev.'},
        {url: 'mad.svg', name: 'MAD'}
        // new Plot("Typical", "typical.svg"),
    ];
    if (measurements.absoluteEstimates.slope) {
        plotAdditional(id, outputDirectory, 'Slope', 'slope.svg', measurements.distributions.slope, measurements.absoluteEstimates.slope);
        additional_plots.push({url: 'slope.svg', name: 'Slope'})
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
    let groupId = group.groupReport.name;
    let reportDir = path.join(outputDirectory, groupId, 'report');
    fs.mkdirSync(reportDir, {recursive: true})

    plotViolin(groupId, outputDirectory, group)

    let context = {
        group_id: group.groupReport.name,
        groupReport: group.groupReport,

        thumbnail_width: 450,
        thumbnail_height: 300,

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
