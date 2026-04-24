import Homey from 'homey';
import * as crypto from "crypto";
import Location from "../../lib/weather/interface/location";
import DailyWeatherVariablesConfig from "../../assets/json/dailyWeatherVariables.json";
import HourlyWeatherVariablesConfig from "../../assets/json/hourlyWeatherVariables.json";
import HourlyAirQualityVariablesConfig from "../../assets/json/hourlyAirQualityVariables.json";
import WeatherDevice from "./device";
import QuickChart from "quickchart-js";
import path from "path";
import Utils from "../../lib/utils";

interface SessionState {
    location?: Location;
    tempUnit?: string;
    windSpeedUnit?: string;
    timezone?: string;
    precipitationUnit?: string;
    hourlyWeatherVariables: string[];
    dailyWeatherVariables: string[];
    hourlyAirQualityValues: string[];
    forecast: number;
}

interface SessionViewRequest {
    view: "setup" | "dailyWeatherVariables" | "hourlyWeatherVariables" | "hourlyAirQualityValues";
}

interface SetupPayload {
    location: Location;
    tempUnit: string;
    windSpeedUnit: string;
    timezone: string;
    precipitationUnit: string;
    forecast: number;
}

interface ChartVariableArgument {
    id: string;
    name: string;
    type: "weather" | "airQuality";
}

interface CreateChartFlowArgs {
    device: WeatherDevice;
    weatherVariable: ChartVariableArgument;
    type?: string;
    lineColor: string;
    backgroundColor: string;
}

class WeatherDriver extends Homey.Driver {
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
        this.log('WeatherDriver has been initialized');
        this._createChartFlow();
    }

    private _createChartFlow() {
        this.homey.flow
            .getActionCard("create-chart")
            .registerArgumentAutocompleteListener('weatherVariable', (query, args) => {
                let device = args.device as WeatherDevice;
                let results: any[] = [];
                let store = this.createSessionState(device.getStore());
                store.hourlyWeatherVariables.forEach((s: string) => {
                    let config = device.getConfig(s);
                    results.push({
                        name: this.homey.__(config?.i18n ?? s),
                        description: this.homey.__("hourlyWeatherVariables"),
                        id: s,
                        type: "weather",
                        config: config
                    });
                });
                store.hourlyAirQualityValues.forEach((s: string) => {
                    let config = device.getConfig(s);
                    results.push({
                        name: this.homey.__(config?.i18n ?? s),
                        description: this.homey.__("hourlyAirQualityVariables"),
                        id: s,
                        type: "airQuality",
                        config: config
                    });
                });
                return results.filter((result: any) => {
                    return result.name.toLowerCase().includes(query.toLowerCase());
                });
            })
            .registerRunListener(async (args: CreateChartFlowArgs) => {
                let device = args.device;
                let labels: string[] = [];
                let data: Array<string | number> = [];
                let unit = ""
                if(args.weatherVariable.type == "weather") {
                    data = (device.latestWeatherReport?.hourly[args.weatherVariable.id] ?? [])
                        .filter((value): value is string | number => value !== null && value !== undefined);
                    unit = device.latestWeatherReport?.hourly_units[args.weatherVariable.id] ?? "";
                }
                if(args.weatherVariable.type == "airQuality") {
                    data = (device.latestAirQualityReport?.hourly[args.weatherVariable.id] ?? [])
                        .filter((value): value is string | number => value !== null && value !== undefined);
                    unit = device.latestAirQualityReport?.hourly_units[args.weatherVariable.id] ?? "";
                }
                if (data.length === 0) {
                    throw new Error(`No chart data available for ${args.weatherVariable.id}`);
                }
                for (let i = 0; i < data.length; i++) {
                    labels.push(i + "");
                }
                let myChart = new QuickChart();
                myChart.setConfig({
                    type: args.type ?? "line",
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: args.weatherVariable.name,
                                data: data,
                                borderColor: QuickChart.getGradientFillHelper('vertical', [
                                    args.lineColor, Utils.hexToRGB(args.lineColor, .5)
                                ]),
                                backgroundColor: QuickChart.getGradientFillHelper('vertical', [
                                    Utils.hexToRGB(args.lineColor, .4), Utils.hexToRGB(args.lineColor, .1)
                                ]),
                                ...Utils.datasetVariables
                            }
                        ],
                    },
                    options: {
                        scales: {
                            ...Utils.scalesXVariables,
                            yAxes: [{
                                scaleLabel: {
                                    labelString: `${args.weatherVariable.name} (${unit})`,
                                    display: true,
                                },
                                ...Utils.scalesYVariables
                            }]
                        },
                        ...Utils.optionVariables,
                    }
                })
                    .setWidth(500)
                    .setHeight(300)
                    .setBackgroundColor(args.backgroundColor)
                    .setDevicePixelRatio(3.0);
                let chartPath = path.join("/userdata/", `chart-${crypto.randomUUID()}.png`);
                await myChart.toFile(chartPath);
                let image = await this.homey.images.createImage();
                image.setPath(chartPath);
                return {
                    chart: image,
                };
            });
    }

    /**
     * This method is called when a repair session starts.
     * Params: session – Bi-directional socket for communication with the front-end
     * Params: device - the device that is currently being repaired
     */
    async onRepair(session: any, device: WeatherDevice) {
        let state = this.createSessionState(device.getStore());
        session.setHandler("getData", async (data: SessionViewRequest) => {
            let store = device.getStore();
            if (data.view === "setup") {
                return {
                    location: store.location,
                    timezone: store.timezone,
                    forecast: store.forecast,
                }
            }
            if (data.view === "dailyWeatherVariables" ||
                data.view === "hourlyWeatherVariables" ||
                data.view === "hourlyAirQualityValues") {
                return {
                    data: device.getCapabilities()
                }
            }

        });

        session.setHandler("setup", async (data: SetupPayload) => {
            await device.setStoreValue("location", data.location);
            await device.setStoreValue("timezone", data.timezone == "auto" ? data.location.timezone : data.timezone);
            await device.setStoreValue("forecast", data.forecast);
            state.tempUnit = data.tempUnit;
            state.windSpeedUnit = data.windSpeedUnit;
            state.precipitationUnit = data.precipitationUnit;
            state.location = data.location;
            state.timezone = data.timezone == "auto" ? data.location.timezone : data.timezone;
            state.forecast = data.forecast;
            return true;
        });
        session.setHandler("hourlyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            state.hourlyWeatherVariables = data;
            return true;
        });

        session.setHandler("dailyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            state.dailyWeatherVariables = data;
            return true;
        });

        session.setHandler("hourlyAirQualityValues", async (data: string[]) => {
            if (data == undefined) return false;
            state.hourlyAirQualityValues = data;
            let capabilities = this.variablesToCapabilities(state);
            await this.syncCapabilities(device, capabilities);
            await device.setStoreValue("dailyWeatherVariables", state.dailyWeatherVariables);
            await device.setStoreValue("hourlyWeatherVariables", state.hourlyWeatherVariables);
            await device.setStoreValue("hourlyAirQualityValues", state.hourlyAirQualityValues);
            await device.update(true)
            return true;
        });
    }

    /**
     * This method is called when a pair session starts.
     * Params: session – Bi-directional socket for communication with the front-end
     */
    async onPair(session: any) {
        let state = this.createSessionState();

        session.setHandler('showView', async (data: any) => {
        });

        //Handle Setup
        session.setHandler("setup", async (data: SetupPayload) => {
            if (data == undefined) return false;
            state.location = data.location;
            state.tempUnit = data.tempUnit;
            state.windSpeedUnit = data.windSpeedUnit;
            state.timezone = data.timezone == "auto" ? data.location.timezone : data.timezone;
            state.precipitationUnit = data.precipitationUnit;
            state.forecast = data.forecast;
            return true;
        });

        session.setHandler("hourlyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            state.hourlyWeatherVariables = data;
            return true;
        });

        session.setHandler("dailyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            state.dailyWeatherVariables = data;
            return true;
        });

        session.setHandler("hourlyAirQualityValues", async (data: string[]) => {
            if (data == undefined) return false;
            state.hourlyAirQualityValues = data;
            return true;
        });

        //Get devices
        session.setHandler("list_devices", async () => {
            if (!state.location || !state.timezone) {
                this.error("Cannot create weather device during pair: missing location or timezone");
                return [];
            }

            let nameExtension = "";
            if(state.forecast > 0){
                nameExtension = ` (+${state.forecast}d)`
            }
            return [
                {
                    name: state.location.name + nameExtension,
                    // The data object is required and should be unique for the device.
                    // So a device's MAC address would be good, but an IP address would
                    // be bad since it can change over time.
                    data: {
                        id: crypto.randomUUID()
                    },
                    store: {
                        location: state.location,
                        tempUnit: state.tempUnit,
                        windSpeedUnit: state.windSpeedUnit,
                        timezone: state.timezone,
                        precipitationUnit: state.precipitationUnit,
                        dailyWeatherVariables: state.dailyWeatherVariables,
                        hourlyWeatherVariables: state.hourlyWeatherVariables,
                        hourlyAirQualityValues: state.hourlyAirQualityValues,
                        forecast: state.forecast,
                    },
                    capabilities: this.variablesToCapabilities(state)
                },
            ];
        });
    }

    private variablesToCapabilities(state: SessionState) {
        let capabilities: string[] = ["date"];
        DailyWeatherVariablesConfig.forEach((d) => {
            if (state.dailyWeatherVariables.includes(d.value) && d.capability != "")
                capabilities.push(d.capability);
            else if (state.dailyWeatherVariables.includes(d.value))
                this.error(d.value + " has no capability")
        });
        HourlyWeatherVariablesConfig.forEach((d) => {
            if (state.hourlyWeatherVariables.includes(d.value) && d.capability != "")
                capabilities.push(d.capability);
            else if (state.hourlyWeatherVariables.includes(d.value))
                this.error(d.value + " has no capability")
        });
        HourlyAirQualityVariablesConfig.forEach((d) => {
            if (state.hourlyAirQualityValues.includes(d.value) && d.capability != "")
                capabilities.push(d.capability);
            else if (state.hourlyAirQualityValues.includes(d.value))
                this.error(d.value + " has no capability")
        });
        return capabilities;
    }

    private createSessionState(store?: {
        location?: Location;
        tempUnit?: string;
        windSpeedUnit?: string;
        timezone?: string;
        precipitationUnit?: string;
        hourlyWeatherVariables?: string[];
        dailyWeatherVariables?: string[];
        hourlyAirQualityValues?: string[];
        forecast?: number | string;
    }): SessionState {
        return {
            location: store?.location,
            tempUnit: store?.tempUnit,
            windSpeedUnit: store?.windSpeedUnit,
            timezone: store?.timezone,
            precipitationUnit: store?.precipitationUnit,
            hourlyWeatherVariables: this.normalizeStringArray(store?.hourlyWeatherVariables),
            dailyWeatherVariables: this.normalizeStringArray(store?.dailyWeatherVariables),
            hourlyAirQualityValues: this.normalizeStringArray(store?.hourlyAirQualityValues),
            forecast: this.normalizeForecast(store?.forecast),
        };
    }

    private async syncCapabilities(device: WeatherDevice, capabilities: string[]) {
        for (let capability of capabilities) {
            if (device.hasCapability(capability)) continue;
            try {
                await device.addCapability(capability);
            } catch (err: any) {
                this.error(`Failed to add capability "${capability}" to ${device.getName()}: ${err?.message ?? err}`);
            }
        }

        for (let deviceCapability of device.getCapabilities()) {
            if (capabilities.includes(deviceCapability)) continue;
            try {
                await device.removeCapability(deviceCapability);
            } catch (err: any) {
                this.error(`Failed to remove capability "${deviceCapability}" from ${device.getName()}: ${err?.message ?? err}`);
            }
        }
    }

    private normalizeForecast(forecast: number | string | undefined) {
        let parsed = Number(forecast ?? 0);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.floor(parsed));
    }

    private normalizeStringArray(values: string[] | undefined) {
        if (!Array.isArray(values)) return [];
        return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
    }
}

module.exports = WeatherDriver;
