import {scaleValues} from "./report.js";
import {Sample, Slope} from "./analysis.js";
import path from "node:path";
import child_process from "node:child_process";

// https://gnuplot.sourceforge.net/docs_4.2/node75.html
function gnuQuote(title) {
    return title.replaceAll(/'/g, "''");
}

export class GnuPlotter {

    static pdf(title, reportDir, measurements) {
        let iterCounts = measurements.iters;
        let maxIters = iterCounts.reduce((acc, x) => Math.max(acc, x));
        let exponent = 3 * Math.floor(Math.log10(maxIters) / 3);

        let scaledNumbers = measurements.times.map((x, i) => x / measurements.iters[i]);
        let typical = scaledNumbers.reduce((acc, x) => Math.max(acc, x));
        let unit = scaleValues(typical, scaledNumbers);
        let scaled_avg_times = new Sample(scaledNumbers);
        let mean = scaled_avg_times.mean();
        let [xs, ys] = sweepAndEstimate(scaled_avg_times, null, mean);

        let figurePath = path.join(reportDir, "pdf.svg");

        let min_x = xs.reduce((acc, x) => Math.min(acc, x));
        let max_x = xs.reduce((acc, x) => Math.max(acc, x));
        let max_y = ys.reduce((acc, y) => Math.max(acc, y)) * 1.1;

        let script = `set output '${figurePath}'
set title '${gnuQuote(title)}'
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

        let [lost, lomt, himt, hist] = measurements.tukey;
        for (let [n, x, y] of measurements.averages.map((x, i) => [
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
        for (let [x, y] of clean) {
            script += `${x} ${y}\n`
        }
        script += "e\n";
        for (let [x, y] of mildOutliers) {
            script += `${x} ${y}\n`
        }
        script += "e\n";
        for (let [x, y] of severeOutliers) {
            script += `${x} ${y}\n`
        }
        script += "e\n";

        let scaledFences = [...measurements.tukey];
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

        GnuPlotter.doPlot(script);
    }

    static pdfSmall(reportDir, iters, times) {
        let scaled_numbers = times.map((time, i) => time / iters[i]);
        let typical = scaled_numbers.reduce((acc, x) => Math.max(acc, x));
        let unit = scaleValues(typical, scaled_numbers);
        let scaled_avg_times = new Sample(scaled_numbers);
        let mean = scaled_avg_times.mean();
        let [xs, ys, mean_y] = sweepAndEstimate(scaled_avg_times, null, mean);

        let figurePath = path.join(reportDir, "pdf_small.svg");

        let min_x = xs.reduce((acc, x) => Math.min(acc, x));
        let max_x = xs.reduce((acc, x) => Math.max(acc, x));
        let max_y = ys.reduce((acc, x) => Math.max(acc, x)) * 1.1;

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

        GnuPlotter.doPlot(script);
    }


    static regressionSmall(reportDir, measurements, statistics) {
        let [lb, ub] = confidenceInterval(
            new Sample(statistics.slope.bootstrap).percentiles(),
            statistics.slope.confidenceLevel,
        );
        let {xs, ys} = {xs: measurements.iters, ys: measurements.times};
        let [max_iters, typical] = [
            xs.reduce((acc, x) => Math.max(acc, x)),
            ys.reduce((acc, y) => Math.max(acc, y))
        ];
        let scaled_numbers = [...ys];
        let unit = scaleValues(typical, scaled_numbers);
        let point_estimate = Slope.fit(xs, ys);
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

        let figurePath = path.join(reportDir, "regression_small.svg");

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

        for (let [x, y] of xs.map((x, i) => [
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

        GnuPlotter.doPlot(script);
    }


    static regression(title, reportDir, measurements, statistics) {
        let [lb, ub] = confidenceInterval(
            new Sample(statistics.slope.bootstrap).percentiles(),
            statistics.slope.confidenceLevel,
        );
        let {xs, ys} = {xs: measurements.iters, ys: measurements.times};
        let [max_iters, typical] = [
            xs.reduce((acc, x) => Math.max(acc, x)),
            ys.reduce((acc, y) => Math.max(acc, y))
        ];
        let scaled_numbers = [...ys];
        let unit = scaleValues(typical, scaled_numbers);
        let point_estimate = Slope.fit(xs, ys);
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

        let figurePath = path.join(reportDir, "regression.svg");

        let script = `set output '${figurePath}'
set title '${gnuQuote(title)}'
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

        for (let [x, y] of xs.map((x, i) => [
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

        GnuPlotter.doPlot(script);
    }

    static statistic(title, filename, statistic) {
        let estimates = statistic.estimates;
        let typical = estimates.upperBound;
        let ci_values = [estimates.lowerBound, estimates.upperBound, estimates.pointEstimate];

        let unit = scaleValues(typical, ci_values);
        let [lb, ub, point] = [ci_values[0], ci_values[1], ci_values[2]];

        let start = lb - (ub - lb) / 9.;
        let end = ub + (ub - lb) / 9.;
        let scaled_xs = [...statistic.bootstrap];
        scaleValues(typical, scaled_xs);
        let scaled_xs_sample = new Sample(scaled_xs);

        let [kde_xs, ys] = sweepAndEstimate(scaled_xs_sample, [start, end]);

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

        let [xMin, xMax] = [
            kde_xs_sample.numbers.reduce((acc, x) => Math.min(acc, x)),
            kde_xs_sample.numbers.reduce((acc, x) => Math.max(acc, x))
        ];

        let script = `set output '${filename}'
set title '${gnuQuote(title)}'
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

        GnuPlotter.doPlot(script);
    }

    static violin(reportDir, benchmarks) {
        let funcs = benchmarks.map(b => b.name);
        let allCurves = benchmarks.map(b => new Sample(b.averages));
        let kdes = allCurves.map(avgTimes => {
            let [xs, ys] = sweepAndEstimate(avgTimes, null, avgTimes[0]);
            let yMax = ys.reduce((acc, y) => Math.max(acc, y));
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

        let figurePath = path.join(reportDir, "violin.svg");

        let plotCommands = []
        for (let i = 0; i < kdes.length; i++) {
            let plotCommand = "'-' using 1:2:3 with filledcurves fillstyle noborder lc rgb '#1f78b4' ";
            plotCommand += i === 0 ? "title 'PDF'" : "notitle";
            plotCommands.push(plotCommand);
        }
        let plotCommand = 'plot ' + plotCommands.join(', ')

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

        GnuPlotter.doPlot(script);
    }

    static doPlot(script) {
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
}

function sweepAndEstimate(sample, range, point_to_estimate) {
    let numPoints = 500;
    let xMin = sample.numbers.reduce((acc, x) => Math.min(acc, x))
    let xMax = sample.numbers.reduce((acc, x) => Math.max(acc, x))

    let kde = new Kde(sample);
    let h = kde.bandwidth;
    let [start, end] = range ? range : [xMin - 3 * h, xMax + 3 * h];

    let xs = [];
    let step_size = (end - start) / (numPoints - 1);
    for (let i = 0; i < numPoints; i++) {
        xs.push(start + step_size * i);
    }
    let ys = xs.map(x => kde.estimate(x));
    let point_estimate = kde.estimate(point_to_estimate);

    return [xs, ys, point_estimate];
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

class Kde {
    constructor(sample) {
        this.sample = sample;
        this.bandwidth = silverman(sample);
    }

    estimate(x) {
        let xs = this.sample.numbers;
        let h = this.bandwidth;
        let n = xs.length;
        let sum = xs.reduce((acc, x_i) => acc + gaussian((x - x_i) / h), 0);
        return sum / (h * n);
    }
}

function silverman(sample) {
    let factor = 4 / 3;
    let exponent = 1 / 5;
    let n = sample.numbers.length;
    let sigma = sample.stdDev();

    return sigma * (factor / n) ** exponent;
}

function gaussian(x) {
    return 1 / Math.sqrt(Math.exp(x ** 2) * 2 * Math.PI);
}
