function isNumericArray(xs, l) {
    let expectedLength = l ?? xs.length;
    return Array.isArray(xs) && xs.length === expectedLength && xs.every(Number.isFinite);
}

class Measurements {
    constructor(iters, times, tukey) {
        this.iters = iters;
        this.times = times;
        this.tukey = tukey;
    }

    get averages() {
        return this.times.map((t, i) => t / this.iters[i])
    }

    static parse(pojo) {
        let {iters, times, tukey} = pojo;

        if (!isNumericArray(iters)) {
            throw new TypeError('expected `measurements.iters` to be a numeric array, was:' + JSON.stringify(tukey));
        }
        if (!isNumericArray(times, iters.length)) {
            throw new TypeError('expected `measurements.times` to be a numeric array');
        }
        if (!isNumericArray(tukey, 4)) {
            throw new TypeError('expected `measurements.tukey` to be a numeric array, was:' + JSON.stringify(tukey));
        }

        return new this(iters, times, tukey)
    }
}

class Estimates {
    constructor(confidenceLevel, lowerBound, upperBound, standardError, pointEstimate) {
        this.confidenceLevel = confidenceLevel;
        this.lowerBound = lowerBound;
        this.upperBound = upperBound;
        this.standardError = standardError;
        this.pointEstimate = pointEstimate;
    }

    static parse(pojo) {
        let {
            confidenceLevel,
            lowerBound,
            upperBound,
            standardError,
            pointEstimate
        } = pojo;
        for (let p of [confidenceLevel, lowerBound, upperBound, standardError, pointEstimate]) {
            if (!Number.isFinite(p)) {
                throw new TypeError(`Expected '${p}' to be a number, was '${typeof p}'`)
            }
        }
        return new this(confidenceLevel, lowerBound, upperBound, standardError, pointEstimate);
    }
}

class Statistic {
    constructor(estimates, bootstrap) {
        this.estimates = estimates;
        this.bootstrap = bootstrap;
    }

    static parse(name, pojo) {
        let knownStatistics = ['mean', 'median', 'medianAbsDev', 'slope', 'stdDev'];
        if (!knownStatistics.includes(name)) {
            throw new TypeError(`Unknown statistic: ${name}`);
        }
        let {estimates, bootstrap} = pojo;
        if (!isNumericArray(pojo.bootstrap)) {
            throw new TypeError(`Expected bootstrap to be a numeric array`)
        }
        return new this(Estimates.parse(estimates), bootstrap);
    }
}

class Statistics {
    constructor(mean, median, medianAbsDev, slope, stdDev) {
        this.mean = mean;
        this.median = median;
        this.medianAbsDev = medianAbsDev;
        this.slope = slope;
        this.stdDev = stdDev;
    }

    static parse(pojo) {
        let {mean, median, medianAbsDev, slope, stdDev} = pojo;
        return new this(
            Statistic.parse('mean', mean),
            Statistic.parse('median', median),
            Statistic.parse('medianAbsDev', medianAbsDev),
            Statistic.parse('slope', slope),
            Statistic.parse('stdDev', stdDev)
        );
    }

    static build(estimates, distributions) {
        let {
            mean,
            median,
            medianAbsDev,
            slope,
            stdDev
        } = Object.fromEntries(Object.keys(estimates).map(statistic =>
            [
                statistic, new Statistic(new Estimates(
                    estimates[statistic].confidenceInterval.confidenceLevel,
                    estimates[statistic].confidenceInterval.lowerBound,
                    estimates[statistic].confidenceInterval.upperBound,
                    estimates[statistic].standardError,
                    estimates[statistic].pointEstimate,
                ),
                distributions[statistic].numbers
            )]));
        return new this(mean, median, medianAbsDev, slope, stdDev);
    }
}

export class ReportData {
    constructor(groupId, functionId, measurements, statistics) {
        this.groupId = groupId;
        this.functionId = functionId;
        this.measurements = measurements;
        this.statistics = statistics;
    }

    get title() {
        return `${this.groupId}/${this.functionId}`;
    }

    static build(id, iters, times, tukey, estimates, distributions) {
        let groupId = id.groupId;
        let functionId = id.functionId;
        return new this(
            groupId,
            functionId,
            new Measurements(iters, times, tukey),
            Statistics.build(estimates, distributions)
        );
    }

    static parse(pojo) {
        let {groupId, functionId, measurements, statistics} = pojo;
        if (typeof groupId !== 'string') {
            throw new Error(`expected \`groupId\` (${groupId}) to be 'string', was '${typeof groupId}'`);
        }
        if (typeof functionId !== 'string') {
            throw new Error(`expected \`functionId\` (${functionId}) to be 'string', was '${typeof functionId}'`);
        }
        return new this(
            groupId,
            functionId,
            Measurements.parse(measurements),
            Statistics.parse(statistics)
        );
    }
}
