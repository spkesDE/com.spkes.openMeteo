import "module-alias/register";
import Homey from 'homey';
import * as crypto from "crypto";
import OpenMeteo from "@/app";
import Forecast, {AirQualityForecast, OpenMeteoVariableMap} from "@/lib/weather/interface/forecast";
import AppManifest from "@/app.json";
import WeatherDevice from "@/drivers/weather/device";
import {getApiValue, getConfiguredCapabilityIds, WeatherConfigSource} from "@/lib/weather/weatherConfig";
import {
    ChartVariableArgument,
    CreateChartFlowArgs,
    ForecastConditionArgs,
    SessionState,
    SessionStateStore,
    SessionViewRequest,
    SetupPayload,
} from "@/drivers/weather/types";
import QuickChart from "quickchart-js";
import path from "path";
import Utils from "@/lib/utils";
import WeatherUnits, {WeatherUnitSystem} from "@/lib/weather/weatherUnits";
import {
    ForecastTarget,
    normalizeForecastDays,
    normalizeForecastHour,
    normalizeForecastHours,
    normalizeForecastMode,
    resolveForecastTarget,
} from "@/lib/weather/forecastTarget";

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
        this._createGetWeatherInHoursFlow();
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
        const initialStore = device.getStore() as SessionStateStore;
        let state = this.createSessionState(initialStore);
        const hasStoredSelection = {
            dailyWeatherVariables: Array.isArray(initialStore.dailyWeatherVariables),
            hourlyWeatherVariables: Array.isArray(initialStore.hourlyWeatherVariables),
            hourlyAirQualityValues: Array.isArray(initialStore.hourlyAirQualityValues),
        };
        session.setHandler("getData", async (data: SessionViewRequest) => {
            if (data.view === "setup") {
                return {
                    location: state.location ?? null,
                    timezone: state.timezone ?? "auto",
                    forecast: state.forecast,
                    forecastMode: state.forecastMode === "legacy_day" ? "day_hour" : state.forecastMode,
                    forecastHours: state.forecastHours,
                    forecastHour: state.forecastMode === "legacy_day"
                        ? Utils.getDateTimePartsInTimeZone(Date.now(), state.timezone ?? "UTC").hour
                        : state.forecastHour,
                    unitSystem: state.unitSystem,
                }
            }
            if (data.view === "dailyWeatherVariables" ||
                data.view === "hourlyWeatherVariables" ||
                data.view === "hourlyAirQualityValues") {
                return {
                    data: state[data.view],
                    capabilities: device.getCapabilities(),
                    hasStoredSelection: hasStoredSelection[data.view],
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
            await device.setStoreValue("forecast", normalizeForecastDays(data.forecast));
            await device.setStoreValue("forecastMode", normalizeForecastMode(data.forecastMode));
            await device.setStoreValue("forecastHours", normalizeForecastHours(data.forecastHours));
            await device.setStoreValue("forecastHour", normalizeForecastHour(data.forecastHour));
            await device.setStoreValue("unitSystem", WeatherUnits.normalize(data.unitSystem));
            state.unitSystem = WeatherUnits.normalize(data.unitSystem);
            state.location = data.location;
            state.timezone = data.timezone == "auto" ? data.location.timezone : data.timezone;
            state.forecast = normalizeForecastDays(data.forecast);
            state.forecastMode = normalizeForecastMode(data.forecastMode);
            state.forecastHours = normalizeForecastHours(data.forecastHours);
            state.forecastHour = normalizeForecastHour(data.forecastHour);
            return true;
        });
        session.setHandler("hourlyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            state.hourlyWeatherVariables = data;
            hasStoredSelection.hourlyWeatherVariables = true;
            return true;
        });

        session.setHandler("dailyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            state.dailyWeatherVariables = data;
            hasStoredSelection.dailyWeatherVariables = true;
            return true;
        });

        session.setHandler("hourlyAirQualityValues", async (data: string[]) => {
            if (data == undefined) return false;
            state.hourlyAirQualityValues = data;
            hasStoredSelection.hourlyAirQualityValues = true;
            let capabilities = this.variablesToCapabilities(state);
            await this.syncCapabilities(device, capabilities);
            await device.setStoreValue("dailyWeatherVariables", state.dailyWeatherVariables);
            await device.setStoreValue("hourlyWeatherVariables", state.hourlyWeatherVariables);
            await device.setStoreValue("hourlyAirQualityValues", state.hourlyAirQualityValues);
            await device.applyUnitSystemCapabilityOptions();
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
            state.timezone = data.timezone == "auto" ? data.location.timezone : data.timezone;
            state.unitSystem = WeatherUnits.normalize(data.unitSystem);
            state.forecast = normalizeForecastDays(data.forecast);
            state.forecastMode = normalizeForecastMode(data.forecastMode);
            state.forecastHours = normalizeForecastHours(data.forecastHours);
            state.forecastHour = normalizeForecastHour(data.forecastHour);
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

            let nameExtension = this.getForecastNameExtension(state);
            let capabilities = this.variablesToCapabilities(state);
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
                        timezone: state.timezone,
                        unitSystem: state.unitSystem,
                        dailyWeatherVariables: state.dailyWeatherVariables,
                        hourlyWeatherVariables: state.hourlyWeatherVariables,
                        hourlyAirQualityValues: state.hourlyAirQualityValues,
                        forecast: state.forecast,
                        forecastMode: state.forecastMode,
                        forecastHours: state.forecastHours,
                        forecastHour: state.forecastHour,
                    },
                    capabilities,
                    capabilitiesOptions: WeatherUnits.getCapabilitiesOptions(capabilities, state.unitSystem),
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
            timezone: store?.timezone,
            unitSystem: WeatherUnits.normalize(
                store?.unitSystem,
                store?.windSpeedUnit,
                store?.precipitationUnit,
            ),
            hourlyWeatherVariables: this.normalizeStringArray(store?.hourlyWeatherVariables),
            dailyWeatherVariables: this.normalizeStringArray(store?.dailyWeatherVariables),
            hourlyAirQualityValues: this.normalizeStringArray(store?.hourlyAirQualityValues),
            forecast: normalizeForecastDays(store?.forecast),
            forecastMode: normalizeForecastMode(store?.forecastMode, store?.forecast !== undefined),
            forecastHours: normalizeForecastHours(store?.forecastHours),
            forecastHour: normalizeForecastHour(store?.forecastHour),
        };
    }

    private getForecastNameExtension(state: SessionState) {
        if (state.forecastMode === "relative_hours") {
            return state.forecastHours > 0 ? ` (+${state.forecastHours}h)` : "";
        }
        if (state.forecastMode === "day_hour") {
            return ` (+${state.forecast}d ${String(state.forecastHour).padStart(2, "0")}:00)`;
        }
        return state.forecast > 0 ? ` (+${state.forecast}d)` : "";
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

        let baseDate = resolveForecastTarget(store.timezone, store).dateTime;
        let config = device.getConfig(variable, "weather");
        let apiValue = config ? getApiValue(config) : variable;
        let response = await (this.homey.app as OpenMeteo).getApi().get<Forecast>("", {
            params: {
                latitude: store.location.latitude,
                longitude: store.location.longitude,
                timezone: store.timezone,
                hourly: apiValue,
                start_date: Utils.toIsoDate(baseDate),
                end_date: Utils.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let times = this.getStringSeries(response.data.hourly, "time");
        let series = this.getNumberSeries(response.data.hourly, apiValue);
        let capabilityId = config?.capability ?? "";
        return {
            labels: times.slice(0, series.length).map((time) => time.slice(5, 16).replace("T", " ")),
            data: this.convertSeriesForCapability(series, capabilityId, store.unitSystem),
            unit: WeatherUnits.getCapabilityUnit(
                capabilityId,
                store.unitSystem,
                response.data.hourly_units[apiValue] ?? "",
            ),
        };
    }

    private async getDailyWeatherChartSeries(device: WeatherDevice, variable: string, period: string) {
        let rangeDays = period === "14d" ? 14 : period === "16d" ? 16 : 7;
        let store = this.createSessionState(device.getStore());
        if (!store.location || !store.timezone) {
            throw new Error("Missing location or timezone");
        }

        let baseDate = resolveForecastTarget(store.timezone, store).dateTime;
        let config = device.getConfig(variable, "weatherDaily");
        let apiValue = config ? getApiValue(config) : variable;
        let response = await (this.homey.app as OpenMeteo).getApi().get<Forecast>("", {
            params: {
                latitude: store.location.latitude,
                longitude: store.location.longitude,
                timezone: store.timezone,
                daily: apiValue,
                start_date: Utils.toIsoDate(baseDate),
                end_date: Utils.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let times = this.getStringSeries(response.data.daily, "time");
        let series = this.getNumberSeries(response.data.daily, apiValue);
        let capabilityId = config?.capability ?? "";
        return {
            labels: times.slice(0, series.length),
            data: this.convertSeriesForCapability(series, capabilityId, store.unitSystem),
            unit: WeatherUnits.getCapabilityUnit(
                capabilityId,
                store.unitSystem,
                response.data.daily_units[apiValue] ?? "",
            ),
        };
    }

    private async getAirQualityChartSeries(device: WeatherDevice, variable: string, period: string) {
        let rangeDays = period === "48h" ? 2 : 1;
        let store = this.createSessionState(device.getStore());
        if (!store.location) {
            throw new Error("Missing location");
        }

        let baseDate = resolveForecastTarget(store.timezone ?? "UTC", store).dateTime;
        let config = device.getConfig(variable, "airQuality");
        let apiValue = config ? getApiValue(config) : variable;
        let response = await (this.homey.app as OpenMeteo).getAirQualityApi().get<AirQualityForecast>("", {
            params: {
                latitude: store.location.latitude,
                longitude: store.location.longitude,
                timezone: store.timezone ?? "UTC",
                hourly: apiValue,
                start_date: Utils.toIsoDate(baseDate),
                end_date: Utils.toIsoDate(this.addDays(baseDate, rangeDays - 1)),
            }
        });

        let times = this.getStringSeries(response.data.hourly, "time");
        let series = this.getNumberSeries(response.data.hourly, apiValue);
        return {
            labels: times.slice(0, series.length).map((time) => time.slice(5, 16).replace("T", " ")),
            data: series,
            unit: response.data.hourly_units[apiValue] ?? "",
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

                let days = normalizeForecastDays(args.days);
                let hour = normalizeForecastHour(args.hour);
                let dateParts = Utils.getDatePartsInTimeZone(Date.now(), store.timezone, days);
                let dateTime = Utils.createDateFromParts(dateParts, {hour});
                return this.getWeatherForecastTokens(args.device, store, {
                    dateTime,
                    date: Utils.toIsoDate(dateTime),
                    dayOffset: days,
                    useCurrent: false,
                });
            });
    }

    private _createGetWeatherInHoursFlow() {
        this.homey.flow
            .getActionCard("get-weather-in-hours")
            .registerRunListener(async (args: { device: WeatherDevice; hours: number }) => {
                let store = this.createSessionState(args.device.getStore());
                if (!store.location || !store.timezone) {
                    throw new Error("Missing location or timezone on device");
                }
                let target = resolveForecastTarget(store.timezone, {
                    ...store,
                    forecastMode: "relative_hours",
                    forecastHours: normalizeForecastHours(args.hours),
                });
                return this.getWeatherForecastTokens(args.device, store, target);
            });
    }

    private async getWeatherForecastTokens(
        device: WeatherDevice,
        store: SessionState,
        target: ForecastTarget,
    ) {
        if (!store.location || !store.timezone) {
            throw new Error("Missing location or timezone on device");
        }
        let response = await (this.homey.app as OpenMeteo).getApi().get<Forecast>("", {
            params: {
                latitude: store.location.latitude,
                longitude: store.location.longitude,
                timezone: store.timezone,
                start_date: target.date,
                end_date: target.date,
                hourly: [
                    "temperature_2m", "apparent_temperature", "dew_point_2m",
                    "relative_humidity_2m", "precipitation_probability", "precipitation",
                    "rain", "showers", "snowfall", "weather_code", "cloud_cover",
                    "visibility", "pressure_msl", "wind_speed_10m", "wind_direction_10m",
                    "wind_gusts_10m",
                ].join(","),
                daily: [
                    "temperature_2m_min", "temperature_2m_max",
                    "apparent_temperature_min", "apparent_temperature_max",
                    "precipitation_sum", "uv_index_max", "wind_gusts_10m_max",
                    "sunrise", "sunset",
                ].join(","),
            }
        });

        let data = response.data;
        let times = data.hourly?.["time"] as string[] | undefined ?? [];
        let targetHourStr = `${target.date}T${String(target.dateTime.getUTCHours()).padStart(2, "0")}:00`;
        let hourIndex = times.findIndex((time) => time === targetHourStr);
        if (hourIndex < 0) {
            throw new Error(`No hourly forecast returned for ${targetHourStr}`);
        }

        let getHourly = (key: string) => {
            let values = data.hourly?.[key];
            if (!Array.isArray(values)) return null;
            let value = values[hourIndex];
            return typeof value === "number" ? value : null;
        };
        let getDaily = (key: string) => {
            let values = data.daily?.[key];
            if (!Array.isArray(values)) return null;
            let value = values[0];
            return typeof value === "number" ? value : null;
        };
        let getDailyTime = (key: string) => {
            let values = data.daily?.[key];
            if (!Array.isArray(values)) return null;
            return Utils.formatTimeValue(values[0], this.getTimeFormatSetting(device));
        };

        let weatherCode = getHourly("weather_code") ?? -1;
        let displayValue = (capabilityId: string, value: number | null) => value === null
            ? null
            : WeatherUnits.convertCapabilityValue(capabilityId, value, store.unitSystem);
        return {
            temperature: getHourly("temperature_2m"),
            apparent_temperature: getHourly("apparent_temperature"),
            dewpoint: getHourly("dew_point_2m"),
            weather_condition: this.homey.__(`wmo.${weatherCode}`) ?? `Unknown (${weatherCode})`,
            weather_code: weatherCode,
            humidity: getHourly("relative_humidity_2m"),
            precipitation_probability: getHourly("precipitation_probability"),
            precipitation: displayValue("measure_precipitation", getHourly("precipitation")),
            rain: displayValue("measure_rain", getHourly("rain")),
            showers: displayValue("measure_showers", getHourly("showers")),
            snowfall: displayValue("measure_snowfall", getHourly("snowfall")),
            cloudcover: getHourly("cloud_cover"),
            visibility: displayValue("measure_visibility", getHourly("visibility")),
            pressure_msl: getHourly("pressure_msl"),
            wind_speed: displayValue("measure_wind_strength", getHourly("wind_speed_10m")),
            wind_direction: getHourly("wind_direction_10m"),
            wind_gusts: displayValue("measure_gust_strength", getHourly("wind_gusts_10m")),
            temperature_min: getDaily("temperature_2m_min"),
            temperature_max: getDaily("temperature_2m_max"),
            apparent_temperature_min: getDaily("apparent_temperature_min"),
            apparent_temperature_max: getDaily("apparent_temperature_max"),
            precipitation_sum: displayValue("measure_precipitation_sum", getDaily("precipitation_sum")),
            uv_index_max: getDaily("uv_index_max"),
            wind_gusts_max: displayValue("measure_windgusts_max", getDaily("wind_gusts_10m_max")),
            sunrise: getDailyTime("sunrise"),
            sunset: getDailyTime("sunset"),
        };
    }

    private normalizeStringArray(values: string[] | undefined) {
        if (!Array.isArray(values)) return [];
        return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
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
            : this.formatCapabilityValue(currentValue, config.capability, device.getUnitSystemForCapability(config.capability));
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

    private formatCapabilityValue(
        value: number,
        capability: string,
        unitSystem: WeatherUnitSystem,
    ) {
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
        let unit = WeatherUnits.getCapabilityUnit(
            capability,
            unitSystem,
            capabilityDefinition?.units?.[language] ?? capabilityDefinition?.units?.en,
        );
        return unit ? `${formattedValue} ${unit}` : formattedValue;
    }

    private convertSeriesForCapability(
        values: number[],
        capabilityId: string,
        unitSystem: WeatherUnitSystem,
    ) {
        return values.map((value) => WeatherUnits.convertCapabilityValue(capabilityId, value, unitSystem));
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
