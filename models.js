function isNumericArray(xs, l) {
    let expectedLength = l ?? xs.length;
    return Array.isArray(xs) && xs.length === expectedLength && xs.every(Number.isFinite);
}

class Measurements {
    constructor(iters, times, averages, tukey) {
        this.iters = iters;
        this.times = times;
        this.averages = averages;
        this.tukey = tukey;
    }

    static parse(pojo) {
        let {iters, times, averages, tukey} = pojo;

        if (!isNumericArray(iters)) {
            throw new Error('expected `measurements.iters` to be a numeric array');
        }
        if (!isNumericArray(times, iters.length)) {
            throw new Error('expected `measurements.times` to be a numeric array');
        }
        if (!isNumericArray(averages, iters.length)) {
            throw new Error('expected `measurements.averages` to be a numeric array');
        }
        if (!isNumericArray(tukey, 4)) {
            throw new Error('expected `measurements.tukey` to be a numeric array');
        }

        return new Measurements(iters, times, averages, tukey)
    }
}

class Estimates {
    constructor(cl, lb, ub, es, point) {
        this.cl = cl;
        this.lb = lb;
        this.ub = ub;
        this.es = es;
        this.point = point;
    }

    static parse(pojo) {
        let {cl, lb, ub, se, point} = pojo;
        for (let p of [cl, lb, ub, se, point]) {
            if (!Number.isFinite(p)) {
                throw new Error(`Expected '${p}' to be a number, was '${typeof p}'`)
            }
        }
        return new Estimates(cl, lb, ub, se, point);
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
            throw new Error(`Unknown statistic: ${name}`);
        }
        let {estimates, bootstrap} = pojo;
        if (!isNumericArray(pojo.bootstrap)) {
            throw new Error(`Expected bootstrap to be a numeric array`)
        }
        return new Statistic(Estimates.parse(estimates), bootstrap);
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
        return new Statistics(
            Statistic.parse('mean', mean),
            Statistic.parse('median', median),
            Statistic.parse('medianAbsDev', medianAbsDev),
            Statistic.parse('slope', slope),
            Statistic.parse('stdDev', stdDev)
        );
    }
}


export class Benchmark {
    constructor(groupId, functionId, measurements, statistics) {
        this.title = `${groupId}/${functionId}`;
        this.groupId = groupId;
        this.functionId = functionId;
        this.measurements = measurements;
        this.statistics = statistics;
    }

    static parse(pojo) {
        let {groupId, functionId, measurements, statistics} = pojo;
        if (typeof groupId !== 'string') {
            throw new Error(`expected \`groupId\` to be 'string', was '${typeof groupId}'`);
        }
        if (typeof functionId !== 'string') {
            throw new Error(`expected \`functionId\` to be 'string', was '${typeof functionId}'`);
        }
        return new Benchmark(
            groupId,
            functionId,
            Measurements.parse(measurements),
            Statistics.parse(statistics)
        );
    }
}
