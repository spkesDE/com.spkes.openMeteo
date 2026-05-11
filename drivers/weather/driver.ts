import Homey from 'homey';
import * as crypto from "crypto";
import Location from "../../lib/weather/interface/location";
import OpenMeteo from "../../app";
import Forecast, {AirQualityForecast, OpenMeteoVariableMap} from "../../lib/weather/interface/forecast";
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
    type: "weather" | "weatherDaily" | "airQuality";
}

interface CreateChartFlowArgs {
    device: WeatherDevice;
    weatherVariable: ChartVariableArgument;
    type?: string;
    period?: string;
    lineColor: string;
    backgroundColor: string;
}

interface ForecastConditionArgs {
    device: WeatherDevice;
    weatherVariable: ChartVariableArgument;
    operator: "gt" | "gte" | "lt" | "lte" | "eq";
    value: number;
}

class WeatherDriver extends Homey.Driver {
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
        this.log('WeatherDriver has been initialized');
        this._registerFlowCards();
    }

    private _registerFlowCards() {
        this._createChartFlow();
        this._createRefreshFlow();
        this._createWeatherStateConditionFlow();
        this._createForecastValueConditionFlow();
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
                store.dailyWeatherVariables.forEach((s: string) => {
                    let config = device.getConfig(s);
                    results.push({
                        name: this.homey.__(config?.i18n ?? s),
                        description: this.homey.__("dailyWeatherVariables"),
                        id: s,
                        type: "weatherDaily",
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
                let chartSeries = await this.getChartSeries(device, args.weatherVariable, args.period ?? "auto");
                if (chartSeries.data.length === 0) {
                    throw new Error(`No chart data available for ${args.weatherVariable.id}`);
                }
                let myChart = new QuickChart();
                myChart.setConfig({
                    type: args.type ?? "line",
                    data: {
                        labels: chartSeries.labels,
                        datasets: [
                            {
                                label: args.weatherVariable.name,
                                data: chartSeries.data,
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
                                    labelString: `${args.weatherVariable.name} (${chartSeries.unit})`,
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

    private _createRefreshFlow() {
        this.homey.flow
            .getActionCard("refresh-weather-now")
            .registerRunListener(async (args: { device: WeatherDevice }) => {
                await args.device.update(true);
                return true;
            });
    }

    private _createWeatherStateConditionFlow() {
        this.homey.flow
            .getConditionCard("is-weather-state")
            .registerRunListener(async (args: { device: WeatherDevice; state: string }) => {
                return args.device.matchesWeatherState(args.state);
            });
    }

    private _createForecastValueConditionFlow() {
        this.homey.flow
            .getConditionCard("forecast-matches")
            .registerArgumentAutocompleteListener("weatherVariable", async (query, args) => {
                let device = args.device as WeatherDevice;
                let store = this.createSessionState(device.getStore());
                let results = store.dailyWeatherVariables.map((variable) => {
                    let config = device.getConfig(variable);
                    return {
                        name: this.homey.__(config?.i18n ?? variable),
                        description: this.homey.__("dailyWeatherVariables"),
                        id: variable,
                        type: "weatherDaily",
                    };
                });
                return results.filter((result) => result.name.toLowerCase().includes(query.toLowerCase()));
            })
            .registerRunListener(async (args: ForecastConditionArgs) => {
                let value = args.device.getForecastValue(args.weatherVariable.id);
                if (typeof value !== "number") return false;

                switch (args.operator) {
                    case "gt":
                        return value > args.value;
                    case "gte":
                        return value >= args.value;
                    case "lt":
                        return value < args.value;
                    case "lte":
                        return value <= args.value;
                    case "eq":
                        return value === args.value;
                    default:
                        return false;
                }
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
        return [...new Set(capabilities)];
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

    private async getChartSeries(device: WeatherDevice, weatherVariable: ChartVariableArgument, period: string) {
        if (weatherVariable.type === "weather") {
            return this.getHourlyWeatherChartSeries(device, weatherVariable.id, period);
        }
        if (weatherVariable.type === "weatherDaily") {
            return this.getDailyWeatherChartSeries(device, weatherVariable.id, period);
        }
        return this.getAirQualityChartSeries(device, weatherVariable.id, period);
    }

    private async getHourlyWeatherChartSeries(device: WeatherDevice, variable: string, period: string) {
        let rangeDays = period === "48h" ? 2 : 1;
        let store = this.createSessionState(device.getStore());
        if (!store.location || !store.timezone) {
            throw new Error("Missing location or timezone");
        }

        let baseDate = this.getBaseDateInTimezone(store.timezone, store.forecast);
        let response = await (this.homey.app as OpenMeteo).getApi().get<Forecast>("", {
            params: {
                latitude: store.location.latitude,
                longitude: store.location.longitude,
                timezone: store.timezone,
                hourly: variable,
                start_date: this.toIsoDate(baseDate),
                end_date: this.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let series = this.getStringOrNumberSeries(response.data.hourly, variable);
        return {
            labels: this.getStringSeries(response.data.hourly, "time").map((time) => time.slice(5, 16).replace("T", " ")),
            data: series,
            unit: response.data.hourly_units[variable] ?? "",
        };
    }

    private async getDailyWeatherChartSeries(device: WeatherDevice, variable: string, period: string) {
        let rangeDays = period === "14d" ? 14 : period === "16d" ? 16 : 7;
        let store = this.createSessionState(device.getStore());
        if (!store.location || !store.timezone) {
            throw new Error("Missing location or timezone");
        }

        let baseDate = this.getBaseDateInTimezone(store.timezone, store.forecast);
        let response = await (this.homey.app as OpenMeteo).getApi().get<Forecast>("", {
            params: {
                latitude: store.location.latitude,
                longitude: store.location.longitude,
                timezone: store.timezone,
                daily: variable,
                start_date: this.toIsoDate(baseDate),
                end_date: this.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let series = this.getStringOrNumberSeries(response.data.daily, variable);
        return {
            labels: this.getStringSeries(response.data.daily, "time"),
            data: series,
            unit: response.data.daily_units[variable] ?? "",
        };
    }

    private async getAirQualityChartSeries(device: WeatherDevice, variable: string, period: string) {
        let rangeDays = period === "48h" ? 2 : 1;
        let store = this.createSessionState(device.getStore());
        if (!store.location) {
            throw new Error("Missing location");
        }

        let baseDate = this.getBaseDateInTimezone(store.timezone ?? "UTC", store.forecast);
        let response = await (this.homey.app as OpenMeteo).getAirQualityApi().get<AirQualityForecast>("", {
            params: {
                latitude: store.location.latitude,
                longitude: store.location.longitude,
                hourly: variable,
                start_date: this.toIsoDate(baseDate),
                end_date: this.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let series = this.getStringOrNumberSeries(response.data.hourly, variable);
        return {
            labels: this.getStringSeries(response.data.hourly, "time").map((time) => time.slice(5, 16).replace("T", " ")),
            data: series,
            unit: response.data.hourly_units[variable] ?? "",
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

    private getBaseDateInTimezone(timeZone: string, forecast: number) {
        let targetTimestamp = Date.now() + (forecast * 24 * 60 * 60 * 1000);
        return new Date(new Date(targetTimestamp).toLocaleString("en-US", {timeZone}));
    }

    private addDays(date: Date, days: number) {
        return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
    }

    private toIsoDate(date: Date) {
        return date.toISOString().split("T")[0];
    }

    private getStringSeries(data: OpenMeteoVariableMap | undefined, key: string) {
        let values = data?.[key];
        if (!Array.isArray(values)) return [];
        return values.filter((value): value is string => typeof value === "string");
    }

    private getStringOrNumberSeries(data: OpenMeteoVariableMap | undefined, key: string) {
        let values = data?.[key];
        if (!Array.isArray(values)) return [];
        return values.filter((value): value is string | number => typeof value === "string" || typeof value === "number");
    }
}

module.exports = WeatherDriver;
