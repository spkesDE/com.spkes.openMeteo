export default class Utils {
    public static hexToRGB(hex: string, alpha?: number) {
        let r = parseInt(hex.slice(1, 3), 16),
            g = parseInt(hex.slice(3, 5), 16),
            b = parseInt(hex.slice(5, 7), 16);

        if (alpha) {
            return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
        } else {
            return "rgb(" + r + ", " + g + ", " + b + ")";
        }
    }

    public static datasetVariables = {
        fill: true,
        borderWidth: 2,
        lineTension: 0.4,
        pointRadius: 0
    }

    public static optionVariables = {
        layout: {
            padding: {
                left: 10,
                right: 30,
                top: 20,
                bottom: 10
            }
        },
        legend: {
            display: false,
        },
    }

    public static scalesYVariables = {
        ticks: {
            beginAtZero: false,
        },
        gridLines: {
            display: true,
            color: 'rgba(125,125,125,0.2)',
            borderDash: [4, 4]
        },
    }

    public static scalesXVariables = {
        xAxes: [{
            gridLines: {
                display: false
            }
        }],
    }

}
