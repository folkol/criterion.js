import Handlebars from "handlebars";

export function renderTemplate(templateName, data) {
    const template = Handlebars.compile(templates[templateName]);
    return template(data);
}

let templates = {
    index: `<!DOCTYPE html>
<html>

<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <title>Index - Criterion.js</title>
    <style type="text/css">
        body {
            font: 14px Helvetica Neue;
            text-rendering: optimizelegibility;
        }

        .body {
            width: 960px;
            margin: auto;
        }

        a:link {
            color: #1F78B4;
            text-decoration: none;
        }

        h2 {
            font-size: 36px;
            font-weight: 300;
        }

        h3 {
            font-size: 24px;
            font-weight: 300;
        }

        #footer {
            height: 40px;
            background: #888;
            color: white;
            font-size: larger;
            font-weight: 300;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        #footer a {
            color: white;
            text-decoration: underline;
        }

        #footer p {
            text-align: center
        }

        table {
            border-collapse: collapse;
        }

        table,
        th,
        td {
            border: 1px solid #888;
        }
    </style>
</head>

<body>
    <div class="body">
        <h2>Criterion.js Benchmark Index</h2>
        See individual benchmark pages below for more details.
        <ul>
            {{#each groups}}
            <a href="../../{{this.path}}">{{this.name}}</a>
            <ul>
                {{#each this.benchmarks }}
                <li>
                <a href="../../{{this.path}}/report/index.html">{{this.name}}</a>
                </li>
                {{/each}}
            </ul>
            {{/each}}
        </ul>
    </div>
    <div id="footer">
        <p>This report was generated by Criterion.js, a nascent JavaScript-port of <a href="https://github.com/bheisler/criterion.rs">Criterion.rs</a>.</p>
    </div>
</body>
</html>`,

    benchmark_report: `<!DOCTYPE html>
<html>

<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <title>{{title}} - Criterion.js</title>
    <style type="text/css">
        body {
            font: 14px Helvetica Neue;
            text-rendering: optimizelegibility;
        }

        .body {
            width: 960px;
            margin: auto;
        }

        th {
            font-weight: 200
        }

        th,
        td {
            padding-right: 3px;
            padding-bottom: 3px;
        }

        a:link {
            color: #1F78B4;
            text-decoration: none;
        }

        th.ci-bound {
            opacity: 0.6
        }

        td.ci-bound {
            opacity: 0.5
        }

        .stats {
            width: 80%;
            margin: auto;
            display: flex;
        }

        .additional_stats {
            flex: 0 0 60%
        }

        .additional_plots {
            flex: 1
        }

        h2 {
            font-size: 36px;
            font-weight: 300;
        }

        h3 {
            font-size: 24px;
            font-weight: 300;
        }

        #footer {
            height: 40px;
            background: #888;
            color: white;
            font-size: larger;
            font-weight: 300;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        #footer a {
            color: white;
            text-decoration: underline;
        }

        #footer p {
            text-align: center
        }
    </style>
</head>

<body>
    <div class="body">
        <h2>{{title}}</h2>
        <div class="absolute">
            <section class="plots">
                <table width="100%">
                    <tbody>
                        <tr>
                            <td>
                                <a href="pdf.svg">
                                    <img src="pdf_small.svg" alt="PDF of Slope" width="{{thumbnail_width}}" height="{{thumbnail_height}}" />
                                </a>
                            </td>
                            <td>
                                {{#if slope }}
                                <a href="regression.svg">
                                    <img src="regression_small.svg" alt="Regression" width="{{thumbnail_width}}" height="{{thumbnail_height}}" />
                                </a>
                                {{else}}
                                <a href="iteration_times.svg">
                                    <img src="iteration_times_small.svg" alt="Iteration Times" width="{{thumbnail_width}}" height="{{thumbnail_height}}" />
                                </a>
                                {{/if}}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
            <section class="stats">
                <div class="additional_stats">
                    <h4>Additional Statistics:</h4>
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th title="{{confidence}} confidence level" class="ci-bound">Lower bound</th>
                                <th>Estimate</th>
                                <th title="{{confidence}} confidence level" class="ci-bound">Upper bound</th>
                            </tr>
                        </thead>
                        <tbody>
                            {{#if slope }}
                            <tr>
                                <td>Slope</td>
                                <td class="ci-bound">{{slope.lower}}</td>
                                <td>{{slope.point}}</td>
                                <td class="ci-bound">{{slope.upper}}</td>
                            </tr>
                            {{/if}}
                            {{#if throughput }}
                            <tr>
                                <td>Throughput</td>
                                <td class="ci-bound">{{throughput.lower}}</td>
                                <td>{{throughput.point}}</td>
                                <td class="ci-bound">{{throughput.upper}}</td>
                            </tr>
                            {{/if}}
                            <tr>
                                <td>R&#xb2;</td>
                                <td class="ci-bound">{{r2.lower}}</td>
                                <td>{{r2.point}}</td>
                                <td class="ci-bound">{{r2.upper}}</td>
                            </tr>
                            <tr>
                                <td>Mean</td>
                                <td class="ci-bound">{{mean.lower}}</td>
                                <td>{{mean.point}}</td>
                                <td class="ci-bound">{{mean.upper}}</td>
                            </tr>
                            <tr>
                                <td title="Standard Deviation">Std. Dev.</td>
                                <td class="ci-bound">{{std_dev.lower}}</td>
                                <td>{{std_dev.point}}</td>
                                <td class="ci-bound">{{std_dev.upper}}</td>
                            </tr>
                            <tr>
                                <td>Median</td>
                                <td class="ci-bound">{{median.lower}}</td>
                                <td>{{median.point}}</td>
                                <td class="ci-bound">{{median.upper}}</td>
                            </tr>
                            <tr>
                                <td title="Median Absolute Deviation">MAD</td>
                                <td class="ci-bound">{{mad.lower}}</td>
                                <td>{{mad.point}}</td>
                                <td class="ci-bound">{{mad.upper}}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                {{#if additional_plots }}
                <div class="additional_plots">
                    <h4>Additional Plots:</h4>
                    <ul>
                        {{#each additional_plots}}
                        <li>
                            <a href="{{this.url}}">{{this.name}}</a>
                        </li>
                        {{/each}}
                    </ul>
                </div>
                {{/if}}
            </section>
            <section class="explanation">
                <h4>Understanding this report:</h4>
                <p>The plot on the left displays the average time per iteration for this benchmark. The shaded region
                    shows the estimated probability of an iteration taking a certain amount of time, while the line
                    shows the mean.</p>
                {{#if slope }}
                <p>The plot on the right shows the linear regression calculated from the measurements. Each point
                    represents a sample, though here it shows the total time for the sample rather than time per
                    iteration. The line is the line of best fit for these measurements.</p>
                {{else}}
                <p>The plot on the right shows the average time per iteration for the samples. Each point 
                    represents one sample.</p>
                {{/if}}
            </section>
        </div>
    </div>
    <div id="footer">
        <p>This report was generated by Criterion.js, a nascent JavaScript-port of
            <a href="https://github.com/bheisler/criterion.rs">Criterion.rs</a>.</p>
    </div>
</body>

</html>`,

    summary_report: `<!DOCTYPE html>
<html>

<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <title>{{group_id}} Summary - Criterion.js</title>
    <style type="text/css">
        body {
            font: 14px Helvetica Neue;
            text-rendering: optimizelegibility;
        }

        .body {
            width: 960px;
            margin: auto;
        }

        a:link {
            color: #1F78B4;
            text-decoration: none;
        }

        h2 {
            font-size: 36px;
            font-weight: 300;
        }

        h3 {
            font-size: 24px;
            font-weight: 300;
        }

        #footer {
            height: 40px;
            background: #888;
            color: white;
            font-size: larger;
            font-weight: 300;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        #footer a {
            color: white;
            text-decoration: underline;
        }

        #footer p {
            text-align: center
        }

        table {
            border-collapse: collapse;
        }

    </style>
</head>

<body>
    <div class="body">
        <h2>{{name}}</h2>
        <h3>Violin Plot</h3>
        <a href="violin.svg">
            <img src="violin.svg" alt="Violin Plot" />
        </a>
        <p>This chart shows the relationship between function/parameter and iteration time. The thickness of the shaded
            region indicates the probability that a measurement of the given function/parameter would take a particular
            length of time.</p>
        {{#each benchmarks}}
        <section class="plots">
            <a href="../../../{{this.path}}/report/index.html">
                <h4>{{this.name}}</h4>
            </a>
            <table width="100%">
                <tbody>
                    <tr>
                        <td>
                            <a href="../../../{{this.path}}/report/pdf.svg">
                                <img src="../../../{{this.path}}/report/pdf_small.svg" alt="PDF of Slope" width="450" height="300" />
                            </a>
                        </td>
                        <td>
                            <a href="../../../{{this.path}}/report/regression.svg">
                                <img src="../../../{{this.path}}/report/regression_small.svg" alt="Regression" width="450" height="300" />
                            </a>
                        </td>
                    </tr>
                </tbody>
            </table>
        </section>
        {{/each}}
    </div>
    <div id="footer">
        <p>This report was generated by Criterion.js, a nascent JavaScript-port of <a href="https://github.com/bheisler/criterion.rs">Criterion.rs</a>.</p>
    </div>
</body>

</html>`
};
