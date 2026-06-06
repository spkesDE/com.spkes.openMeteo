import Homey from 'homey';
import * as crypto from "crypto";
import OpenMeteo from "../../app";
import Forecast, {AirQualityForecast, OpenMeteoVariableMap} from "../../lib/weather/interface/forecast";
import AppManifest from "../../app.json";
import WeatherDevice from "./device";
import {getConfiguredCapabilityIds, WeatherConfigSource} from "../../lib/weather/weatherConfig";
import {
    ChartVariableArgument,
    CreateChartFlowArgs,
    ForecastConditionArgs,
    SessionState,
    SessionStateStore,
    SessionViewRequest,
    SetupPayload,
} from "./types";
import QuickChart from "quickchart-js";
import path from "path";
import Utils from "../../lib/utils";

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
        this._createGetWeatherForecastFlow();
    }

    private _createChartFlow() {
        this.homey.flow
            .getActionCard("create-chart")
            .registerArgumentAutocompleteListener('weatherVariable', (query, args) => {
                let device = args.device as WeatherDevice;
                let results: ChartVariableArgument[] = [];
                let store = this.createSessionState(device.getStore());
                store.hourlyWeatherVariables.forEach((s: string) => {
                    let config = device.getConfig(s, "weather");
                    if (!this.isChartableVariable(config)) return;
                    results.push(this.buildFlowVariableArgument(device, s, "hourlyWeatherVariables", "weather"));
                });
                store.dailyWeatherVariables.forEach((s: string) => {
                    let config = device.getConfig(s, "weatherDaily");
                    if (!this.isChartableVariable(config)) return;
                    results.push(this.buildFlowVariableArgument(device, s, "dailyWeatherVariables", "weatherDaily"));
                });
                store.hourlyAirQualityValues.forEach((s: string) => {
                    let config = device.getConfig(s, "airQuality");
                    if (!this.isChartableVariable(config)) return;
                    results.push(this.buildFlowVariableArgument(device, s, "hourlyAirQualityVariables", "airQuality"));
                });
                return results.filter((result) => {
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
                let results: ChartVariableArgument[] = [];

                store.hourlyWeatherVariables.forEach((variable) => {
                    let config = device.getConfig(variable, "weather");
                    if (!this.isComparableVariable(config)) return;
                    results.push(this.buildFlowVariableArgument(device, variable, "hourlyWeatherVariables", "weather"));
                });

                store.dailyWeatherVariables.forEach((variable) => {
                    let config = device.getConfig(variable, "weatherDaily");
                    if (!this.isComparableVariable(config)) return;
                    results.push(this.buildFlowVariableArgument(device, variable, "dailyWeatherVariables", "weatherDaily"));
                });

                store.hourlyAirQualityValues.forEach((variable) => {
                    let config = device.getConfig(variable, "airQuality");
                    if (!this.isComparableVariable(config)) return;
                    results.push(this.buildFlowVariableArgument(device, variable, "hourlyAirQualityVariables", "airQuality"));
                });

                return results.filter((result) => result.name.toLowerCase().includes(query.toLowerCase()));
            })
            .registerRunListener(async (args: ForecastConditionArgs) => {
                let value = args.device.getComparableWeatherValue(args.weatherVariable.id, args.weatherVariable.type);
                if (value === null) return false;

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
            if (!Utils.isValidLocation(data?.location)) {
                this.error("Cannot repair weather device: invalid location payload");
                return false;
            }
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
            if (data == undefined || !Utils.isValidLocation(data.location)) {
                this.error("Cannot pair weather device: invalid location payload");
                return false;
            }
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
        return getConfiguredCapabilityIds(state);
    }

    private createSessionState(store?: SessionStateStore): SessionState {
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
                start_date: Utils.toIsoDate(baseDate),
                end_date: Utils.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let times = this.getStringSeries(response.data.hourly, "time");
        let series = this.getNumberSeries(response.data.hourly, variable);
        return {
            labels: times.slice(0, series.length).map((time) => time.slice(5, 16).replace("T", " ")),
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
                start_date: Utils.toIsoDate(baseDate),
                end_date: Utils.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let times = this.getStringSeries(response.data.daily, "time");
        let series = this.getNumberSeries(response.data.daily, variable);
        return {
            labels: times.slice(0, series.length),
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
                start_date: Utils.toIsoDate(baseDate),
                end_date: Utils.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let times = this.getStringSeries(response.data.hourly, "time");
        let series = this.getNumberSeries(response.data.hourly, variable);
        return {
            labels: times.slice(0, series.length).map((time) => time.slice(5, 16).replace("T", " ")),
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

    private _createGetWeatherForecastFlow() {
        this.homey.flow
            .getActionCard("get-weather-forecast")
            .registerRunListener(async (args: { device: WeatherDevice; days: number; hour: number }) => {
                let store = this.createSessionState(args.device.getStore());
                if (!store.location || !store.timezone) {
                    throw new Error("Missing location or timezone on device");
                }

                let days = Math.max(0, Math.min(16, Math.floor(args.days ?? 0)));
                let hour = Math.max(0, Math.min(23, Math.floor(args.hour ?? 12)));

                let baseDate = this.getBaseDateInTimezone(store.timezone, days);
                let dateStr = Utils.toIsoDate(baseDate);

                let response = await (this.homey.app as OpenMeteo).getApi().get<Forecast>("", {
                    params: {
                        latitude: store.location.latitude,
                        longitude: store.location.longitude,
                        timezone: store.timezone,
                        start_date: dateStr,
                        end_date: dateStr,
                        hourly: [
                            "temperature_2m", "apparent_temperature", "dewpoint_2m",
                            "relativehumidity_2m", "precipitation_probability", "precipitation",
                            "rain", "showers", "snowfall", "weathercode", "cloudcover",
                            "visibility", "pressure_msl", "windspeed_10m", "winddirection_10m",
                            "windgusts_10m",
                        ].join(","),
                        daily: [
                            "temperature_2m_min", "temperature_2m_max",
                            "apparent_temperature_min", "apparent_temperature_max",
                            "precipitation_sum", "uv_index_max", "windgusts_10m_max",
                            "sunrise", "sunset",
                        ].join(","),
                    }
                });

                let data = response.data;
                let times = data.hourly?.["time"] as string[] | undefined ?? [];
                let targetHourStr = `${dateStr}T${String(hour).padStart(2, "0")}:00`;
                let hourIndex = times.findIndex((t) => t === targetHourStr);
                if (hourIndex < 0) hourIndex = Math.min(hour, Math.max(0, times.length - 1));

                let getHourly = (key: string) => {
                    let arr = data.hourly?.[key];
                    if (!Array.isArray(arr)) return null;
                    let val = arr[hourIndex];
                    return typeof val === "number" ? val : null;
                };
                let getDaily = (key: string) => {
                    let arr = data.daily?.[key];
                    if (!Array.isArray(arr)) return null;
                    let val = arr[0];
                    return typeof val === "number" ? val : null;
                };
                let getDailyTime = (key: string) => {
                    let arr = data.daily?.[key];
                    if (!Array.isArray(arr)) return null;
                    let val = arr[0];
                    return Utils.formatTimeValue(val, this.getTimeFormatSetting(args.device));
                };

                let weatherCode = getHourly("weathercode") ?? -1;
                return {
                    temperature: getHourly("temperature_2m"),
                    apparent_temperature: getHourly("apparent_temperature"),
                    dewpoint: getHourly("dewpoint_2m"),
                    weather_condition: this.homey.__(`wmo.${weatherCode}`) ?? `Unknown (${weatherCode})`,
                    weather_code: weatherCode,
                    humidity: getHourly("relativehumidity_2m"),
                    precipitation_probability: getHourly("precipitation_probability"),
                    precipitation: getHourly("precipitation"),
                    rain: getHourly("rain"),
                    showers: getHourly("showers"),
                    snowfall: getHourly("snowfall"),
                    cloudcover: getHourly("cloudcover"),
                    visibility: getHourly("visibility"),
                    pressure_msl: getHourly("pressure_msl"),
                    wind_speed: getHourly("windspeed_10m"),
                    wind_direction: getHourly("winddirection_10m"),
                    wind_gusts: getHourly("windgusts_10m"),
                    temperature_min: getDaily("temperature_2m_min"),
                    temperature_max: getDaily("temperature_2m_max"),
                    apparent_temperature_min: getDaily("apparent_temperature_min"),
                    apparent_temperature_max: getDaily("apparent_temperature_max"),
                    precipitation_sum: getDaily("precipitation_sum"),
                    uv_index_max: getDaily("uv_index_max"),
                    wind_gusts_max: getDaily("windgusts_10m_max"),
                    sunrise: getDailyTime("sunrise"),
                    sunset: getDailyTime("sunset"),
                };
            });
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
        return Utils.createDateFromParts(Utils.getDatePartsInTimeZone(Date.now(), timeZone, forecast));
    }

    private addDays(date: Date, days: number) {
        return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
    }

    private getStringSeries(data: OpenMeteoVariableMap | undefined, key: string) {
        let values = data?.[key];
        if (!Array.isArray(values)) return [];
        return values.filter((value): value is string => typeof value === "string");
    }

    private getNumberSeries(data: OpenMeteoVariableMap | undefined, key: string) {
        let values = data?.[key];
        if (!Array.isArray(values)) return [];
        return values.filter((value): value is number => typeof value === "number");
    }

    private buildFlowVariableArgument(
        device: WeatherDevice,
        variable: string,
        categoryI18nKey: "hourlyWeatherVariables" | "dailyWeatherVariables" | "hourlyAirQualityVariables",
        type: "weather" | "weatherDaily" | "airQuality"
    ): ChartVariableArgument {
        let config = device.getConfig(variable, type as WeatherConfigSource);
        let category = this.homey.__(categoryI18nKey);
        let currentValue = device.getComparableWeatherValue(variable, type as WeatherConfigSource);
        let formattedCurrentValue = currentValue === null || !config?.capability
            ? null
            : this.formatCapabilityValue(currentValue, config.capability);
        let description = currentValue === null
            ? category
            : `${category} - ${this.homey.__("currentValue")}: ${formattedCurrentValue ?? this.formatFlowValue(currentValue)}`;

        return {
            name: this.homey.__(config?.i18n ?? variable),
            description,
            id: variable,
            type,
        };
    }

    private formatFlowValue(value: number) {
        let language = this.homey.i18n.getLanguage();
        return new Intl.NumberFormat(language, {
            maximumFractionDigits: 2,
        }).format(value);
    }

    private formatCapabilityValue(value: number, capability: string) {
        let manifest = AppManifest as {
            capabilities?: Record<string, {
                decimals?: number;
                units?: Record<string, string>;
            }>;
        };
        let capabilityDefinition = manifest.capabilities?.[capability];
        let language = this.homey.i18n.getLanguage();
        let formattedValue = new Intl.NumberFormat(language, {
            minimumFractionDigits: 0,
            maximumFractionDigits: capabilityDefinition?.decimals ?? 2,
        }).format(value);
        let unit = capabilityDefinition?.units?.[language] ?? capabilityDefinition?.units?.en;
        return unit ? `${formattedValue} ${unit}` : formattedValue;
    }

    private isChartableVariable(config: {
        value: string;
        labelOf?: string;
    } | null) {
        if (!config) return false;
        if (config.labelOf) return false;
        return !["weatherCondition", "alarm_rain", "alarm_freeze_risk", "sunrise", "sunset"].includes(config.value);
    }

    private isComparableVariable(config: {
        value: string;
        labelOf?: string;
        capability: string;
    } | null) {
        if (!config?.capability) return false;
        if (config.labelOf) return false;
        return !["weatherCondition", "alarm_rain", "alarm_freeze_risk", "sunrise", "sunset"].includes(config.value);
    }

    private getTimeFormatSetting(device: WeatherDevice) {
        let configuredFormat = device.getSetting("time_format");
        return typeof configuredFormat === "string" && configuredFormat.trim()
            ? configuredFormat.trim()
            : "HH:mm";
    }
}

module.exports = WeatherDriver;
