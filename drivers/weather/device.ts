import Homey from 'homey';
import Location from "../../lib/weather/interface/location";
import OpenMeteo from "../../app";
import Forecast, {AirQualityForecast, OpenMeteoVariableMap} from "../../lib/weather/interface/forecast";
import DailyWeatherVariablesConfig from "../../assets/json/dailyWeatherVariables.json";
import HourlyWeatherVariablesConfig from "../../assets/json/hourlyWeatherVariables.json";
import HourlyAirQualityVariablesConfig from "../../assets/json/hourlyAirQualityVariables.json";

interface DeviceStore {
    location?: Location;
    timezone?: string;
    forecast?: number | string;
    dailyWeatherVariables?: string[];
    hourlyWeatherVariables?: string[];
    hourlyAirQualityValues?: string[];
}

export interface WeatherFlowSnapshot {
    hasWeatherData: boolean;
    conditionCode: number;
    conditionLabel: string;
    rainLikely: boolean;
    freezing: boolean;
    windy: boolean;
    hot: boolean;
    goodAirQuality: boolean;
    severeExpected: boolean;
    severeReasons: string[];
}

export default class WeatherDevice extends Homey.Device {
    private updateInterval!: NodeJS.Timeout;
    private randomNumber: number = 15;
    private isUpdating: boolean = false;
    private isUninitializing: boolean = false;
    public latestWeatherReport?: Forecast;
    public latestAirQualityReport?: AirQualityForecast;

    async onInit() {
        this.randomNumber = Math.floor(Math.random() * (15 - 2 + 1) + 2);

        if(this.hasCapability("mesaure_weathercode")){
            await this.removeCapability("mesaure_weathercode")
            await this.addCapability("measure_weathercode")
        }

        try {
            await this.update(true);
        } catch (err: any) {
            this.error(`Initial weather update failed for ${this.getName()}: ${err?.message ?? err}`);
        }
        this.updateInterval = this.homey.setInterval(() => {
            this.update().catch((err) => this.error(err));
        }, 1000 * 60);

        this.log('WeatherDevice has been initialized');
    }

    public async update(ignore: boolean = false) {
        if (this.isUninitializing || this.isUpdating) return;

        //Interval runs at 1 minute. But we want weather pooling to be not every minute and
        //still have weather pooling at the start of the hour. So we have to generate a random number to even out the pooling
        //so the API Servers are not overloaded and check that random number (2-15) to the current minutes of the hour.
        if (new Date().getMinutes() !== this.randomNumber && !ignore) return;
        this.isUpdating = true;

        try {
            let store = this.getNormalizedStore();
            let previousSnapshot = this.getFlowSnapshot();
            if (!store.location || !store.timezone) {
                this.error(`Skipping weather update for ${this.getName()}: missing location or timezone in device store`);
                return;
            }

            let date = this.getTargetDateInTimezone(store.timezone, store.forecast);
            let currentHourInTimezone = this.getNowInTimezone(store.timezone).getHours();

            //Getting the weather data from open-meteo
            let weather = await this.getCurrentWeather(
                store.location,
                store.timezone,
                store.hourlyWeatherVariables.filter((e: string) => this.getConfig(e)?.apiVar === true),
                store.dailyWeatherVariables,
                date.toISOString().split('T')[0]
            );

            this.latestWeatherReport = weather;

            //Setting the weather variables
            for (let v of store.dailyWeatherVariables) {
                await this.updateWeather(v, weather.daily);
            }
            for (let v of store.hourlyWeatherVariables) {
                await this.updateWeather(v, weather.hourly, currentHourInTimezone);
            }

            //Setting Date capability to current day/time
            if(this.hasCapability("date")) {
                let hours = ("0" + date.getHours()).slice(-2) + ":" + ("0" + date.getMinutes()).slice(-2);
                let day = ("0" + date.getDate()).slice(-2) + "." + ("0" + (date.getMonth()+1)).slice(-2) + "." + date.getFullYear();
                await this.setCapabilityValue("date", `${hours} ${day}`);
            }

            if (store.hourlyAirQualityValues.length > 0) {
                let airQuality = await this.getAirQuality(store.location, store.hourlyAirQualityValues, date.toISOString().split('T')[0]);
                this.latestAirQualityReport = airQuality;
                for (let v of store.hourlyAirQualityValues) {
                    await this.updateWeather(v, airQuality.hourly);
                }
            } else {
                this.latestAirQualityReport = undefined;
            }

            await this.updateDerivedAlarmCapabilities();

            if (!this.isUninitializing) {
                await this.triggerFlowStateChanges(previousSnapshot, this.getFlowSnapshot());
                await this.homey.flow.getDeviceTriggerCard("weather-has-been-updated").trigger(this);
            }
            this.log(`Updating weather for location: ${store.location.name}`)
        } catch (err: any) {
            let store = this.getNormalizedStore();
            this.error(`Failed to update weather for ${this.getName()} (${store.location?.name ?? "unknown location"}, forecast +${store.forecast}d): ${err?.message ?? err}`);
        } finally {
            this.isUpdating = false;
        }
    }

    public async updateWeather(weatherValue: string, weatherArray: OpenMeteoVariableMap | undefined, index: number = 0) {
        //Getting JSON entry of the weatherValue
        let config = this.getConfig(weatherValue);
        if (config === null) {
            this.error(`No config found for weather value "${weatherValue}" on ${this.getName()}`);
            return;
        }
        let capabilityId = this.resolveCapabilityId(config.capability);
        if (!capabilityId) return;

        if (config.value == "weatherCondition") {
            let weatherCodes = weatherArray?.["weathercode"];
            if (!Array.isArray(weatherCodes)) {
                this.error(`Weather field "weathercode" is missing in API response for ${this.getName()} (requested by "${weatherValue}")`);
                return;
            }

            let safeIndex = Math.max(0, Math.min(index, weatherCodes.length - 1));
            let rawWmoCode = weatherCodes[safeIndex];
            let wmoCode = typeof rawWmoCode === "number" ? rawWmoCode : -1;
            await this.setCapabilityValue(capabilityId, this.homey.__(`wmo.${wmoCode}`) ?? `Unknown Weather (${wmoCode})`);
            return;
        }

        let values = weatherArray?.[config.value];
        if (!Array.isArray(values)) {
            this.error(`Weather field "${config.value}" is missing in API response for ${this.getName()} (requested by "${weatherValue}")`);
            return;
        }

        let safeIndex = Math.max(0, Math.min(index, values.length - 1));
        let value = values[safeIndex];

        if (value === undefined) {
            this.error(`Weather field "${config.value}" has no value at index ${index} for ${this.getName()} (using index ${safeIndex})`);
            return;
        }

        //Custom setCapabilityValue for sunrise and sunset to format date to hours:minutes
        if (config.value == "sunrise") {
            if (typeof value !== "string" && typeof value !== "number") return;
            let d = new Date(value);
            if (Number.isNaN(d.getTime())) return;
            await this.setCapabilityValue(capabilityId, ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2));
            return;
        }
        if (config.value == "sunset") {
            if (typeof value !== "string" && typeof value !== "number") return;
            let d = new Date(value);
            if (Number.isNaN(d.getTime())) return;
            await this.setCapabilityValue(capabilityId, ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2));
            return;
        }
        //If number capability set value.
        await this.setCapabilityValue(capabilityId, value ?? 0).catch((err) => this.error(err))
    }

    public getConfig(query: string): { value: string; i18n: string; apiVar: boolean; default: boolean; capability: string } | null {
        let result = null;
        HourlyWeatherVariablesConfig.forEach((v) => {
            if (v.value === query) {
                result = v;
                return;
            }
        })
        if(result !== null) return result;
        DailyWeatherVariablesConfig.forEach((v) => {
            if (v.value === query) {
                result = v;
                return;
            }
        })
        if(result !== null) return result;
        HourlyAirQualityVariablesConfig.forEach((v) => {
            if (v.value === query) {
                result = v;
                return;
            }
        })
        return result;
    }

    public getFlowSnapshot(): WeatherFlowSnapshot {
        let weather = this.latestWeatherReport;
        let airQuality = this.latestAirQualityReport;
        let hourly = weather?.hourly;
        let daily = weather?.daily;
        let airHourly = airQuality?.hourly;

        let currentHour = this.getCurrentHourIndex(hourly?.time, this.getNormalizedStore().timezone);
        let temperature = this.getNumericSeriesValue(hourly, "temperature_2m", currentHour);
        let temperatureMin = this.getNumericSeriesValue(daily, "temperature_2m_min", 0);
        let temperatureMax = this.getNumericSeriesValue(daily, "temperature_2m_max", 0);
        let precipitationProbabilityHourly = this.getNumericSeriesValue(hourly, "precipitation_probability", currentHour);
        let precipitationProbabilityDaily = this.getNumericSeriesValue(daily, "precipitation_probability_max", 0);
        let precipitationProbability = precipitationProbabilityHourly ?? precipitationProbabilityDaily ?? 0;
        let precipitationAmount = this.getNumericSeriesValue(hourly, "precipitation", currentHour) ?? 0;
        let rainAmount = this.getNumericSeriesValue(hourly, "rain", currentHour) ?? 0;
        let showersAmount = this.getNumericSeriesValue(hourly, "showers", currentHour) ?? 0;
        let windSpeed = this.getNumericSeriesValue(hourly, "windspeed_10m", currentHour)
            ?? this.getNumericSeriesValue(daily, "windspeed_10m_max", 0)
            ?? 0;
        let windGusts = this.getNumericSeriesValue(hourly, "windgusts_10m", currentHour)
            ?? this.getNumericSeriesValue(daily, "windgusts_10m_max", 0)
            ?? 0;
        let uvIndexMax = this.getNumericSeriesValue(daily, "uv_index_max", 0) ?? 0;
        let pm25 = this.getNumericSeriesValue(airHourly, "pm2_5", currentHour);
        let weatherCode = this.getNumericSeriesValue(hourly, "weathercode", currentHour)
            ?? weather?.current_weather?.weathercode
            ?? -1;
        let conditionLabel = this.homey.__(`wmo.${weatherCode}`) ?? `Unknown Weather (${weatherCode})`;
        let severeReasons: string[] = [];

        if (precipitationProbability >= 85) severeReasons.push("rain");
        if (windSpeed >= 60 || windGusts >= 80) severeReasons.push("wind");
        if ((temperatureMin ?? temperature ?? 0) <= -5) severeReasons.push("freeze");
        if (uvIndexMax >= 8) severeReasons.push("uv");
        if ((pm25 ?? 0) >= 55) severeReasons.push("air_quality");

        return {
            hasWeatherData: !!weather,
            conditionCode: weatherCode,
            conditionLabel,
            rainLikely: precipitationProbability >= 60 || precipitationAmount > 0 || rainAmount > 0 || showersAmount > 0,
            freezing: (temperature ?? temperatureMin ?? 1) <= 0 || (temperatureMin ?? 1) <= 0,
            windy: windSpeed >= 35 || windGusts >= 50,
            hot: (temperature ?? temperatureMax ?? 0) >= 28 || (temperatureMax ?? 0) >= 28,
            goodAirQuality: pm25 !== undefined ? pm25 <= 15 : false,
            severeExpected: severeReasons.length > 0,
            severeReasons,
        };
    }

    public matchesWeatherState(state: string) {
        let snapshot = this.getFlowSnapshot();
        switch (state) {
            case "rain_likely":
                return snapshot.rainLikely;
            case "freezing":
                return snapshot.freezing;
            case "windy":
                return snapshot.windy;
            case "hot":
                return snapshot.hot;
            case "good_air_quality":
                return snapshot.goodAirQuality;
            default:
                return false;
        }
    }

    public getForecastValue(variable: string) {
        return this.latestWeatherReport?.daily?.[variable]?.[0];
    }

    private async getCurrentWeather(location: Location, timeZone: string, hourlyWeatherValues: string[], dailyWeatherValues: string[], startDate: string): Promise<Forecast> {
        if (this.isUninitializing) {
            throw new Error("Device is shutting down");
        }

        let app = this.homey.app as OpenMeteo;
        return app.getApi()
            .get<Forecast>("", {
                params: this.buildWeatherParams(location, timeZone, startDate, hourlyWeatherValues, dailyWeatherValues)
            })
            .then((r) => {
                if (r.status == 200) {
                    return r.data;
                }
                throw new Error(`Failed to get weather. Status ${r.status}`);
            }).catch((err) => {
                throw new Error(err?.message ?? String(err));
            });
    }

    private async getAirQuality(location: Location, hourlyAirQualityValues: string[], startDate: string): Promise<AirQualityForecast> {
        if (this.isUninitializing) {
            throw new Error("Device is shutting down");
        }

        let app = this.homey.app as OpenMeteo;
        return app.getAirQualityApi()
            .get<AirQualityForecast>("", {
                params: this.buildAirQualityParams(location, startDate, hourlyAirQualityValues)
            })
            .then((r) => {
                if (r.status == 200) {
                    return r.data;
                }
                throw new Error(`Failed to get weather. Status ${r.status}`);
            }).catch((err) => {
                throw new Error(err?.message ?? String(err));
            });
    }

    async onUninit() {
        this.isUninitializing = true;
        this.clearUpdateInterval();
    }

    onDeleted() {
        this.isUninitializing = true;
        this.clearUpdateInterval();
        let locationName = this.getNormalizedStore().location?.name ?? this.getName();
        this.log("WeatherDevice with location: " + locationName + " deleted. Cleared interval.");
    }

    private clearUpdateInterval() {
        if (!this.updateInterval) return;
        this.homey.clearInterval(this.updateInterval);
    }

    private async updateDerivedAlarmCapabilities() {
        let snapshot = this.getFlowSnapshot();
        await this.setBooleanCapabilityIfPresent("alarm_rain", snapshot.rainLikely);
        await this.setBooleanCapabilityIfPresent("alarm_freeze_risk", snapshot.freezing);
    }

    private async triggerFlowStateChanges(previous: WeatherFlowSnapshot, current: WeatherFlowSnapshot) {
        if (!previous.hasWeatherData || !current.hasWeatherData) return;

        if (previous.conditionCode !== current.conditionCode) {
            await this.homey.flow.getDeviceTriggerCard("weather-condition-changed").trigger(this, {
                previous_condition: previous.conditionLabel,
                current_condition: current.conditionLabel,
                previous_code: previous.conditionCode,
                current_code: current.conditionCode,
            });
        }

        await this.triggerThresholdChange("rain_likely", previous.rainLikely, current.rainLikely);
        await this.triggerThresholdChange("freezing", previous.freezing, current.freezing);
        await this.triggerThresholdChange("windy", previous.windy, current.windy);
        await this.triggerThresholdChange("hot", previous.hot, current.hot);
        await this.triggerThresholdChange("good_air_quality", previous.goodAirQuality, current.goodAirQuality);

        if (!previous.rainLikely && current.rainLikely) {
            await this.homey.flow.getDeviceTriggerCard("rain-started").trigger(this);
        }

        if (previous.rainLikely && !current.rainLikely) {
            await this.homey.flow.getDeviceTriggerCard("rain-stopped").trigger(this);
        }

        if (!previous.severeExpected && current.severeExpected) {
            await this.homey.flow.getDeviceTriggerCard("severe-weather-expected").trigger(this, {
                reasons: current.severeReasons.join(", "),
            });
        }
    }

    private async triggerThresholdChange(threshold: string, previous: boolean, current: boolean) {
        if (previous === current) return;

        await this.homey.flow.getDeviceTriggerCard("weather-threshold-crossed").trigger(this, {
            threshold,
            active: current ? "true" : "false",
        });
    }

    private getNormalizedStore(): {
        location?: Location;
        timezone?: string;
        forecast: number;
        dailyWeatherVariables: string[];
        hourlyWeatherVariables: string[];
        hourlyAirQualityValues: string[];
    } {
        let store = this.getStore() as DeviceStore;
        return {
            location: store.location,
            timezone: store.timezone,
            forecast: this.normalizeForecast(store.forecast),
            dailyWeatherVariables: this.normalizeStringArray(store.dailyWeatherVariables),
            hourlyWeatherVariables: this.normalizeStringArray(store.hourlyWeatherVariables),
            hourlyAirQualityValues: this.normalizeStringArray(store.hourlyAirQualityValues),
        };
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

    private getCurrentHourIndex(times?: Array<string | number | null>, timeZone?: string) {
        if (!Array.isArray(times) || times.length === 0) return 0;
        let currentHourIso = new Date(new Date().toLocaleString("en-US", {timeZone: timeZone ?? "UTC"})).toISOString().slice(0, 13);
        let matchIndex = times.findIndex((time) => typeof time === "string" && time.startsWith(currentHourIso));
        return matchIndex >= 0 ? matchIndex : 0;
    }

    private getNumericSeriesValue(data: OpenMeteoVariableMap | undefined, key: string, index: number) {
        let value = data?.[key]?.[index];
        return typeof value === "number" ? value : undefined;
    }

    private async setBooleanCapabilityIfPresent(capability: string, value: boolean) {
        if (!this.hasCapability(capability)) return;
        await this.setCapabilityValue(capability, value).catch((err) => this.error(err));
    }

    private resolveCapabilityId(capability: string) {
        if (this.hasCapability(capability)) return capability;

        let legacyCapabilities: Record<string, string> = {
            measure_o3: "measure_ozone",
            measure_so2: "measure_sulphur_dioxide",
        };

        let legacyCapability = legacyCapabilities[capability];
        if (legacyCapability && this.hasCapability(legacyCapability)) {
            return legacyCapability;
        }

        return null;
    }

    private getTargetDateInTimezone(timeZone: string, forecast: number) {
        let targetTimestamp = Date.now() + (forecast * 24 * 60 * 60 * 1000);
        return new Date(new Date(targetTimestamp).toLocaleString("en-US", {timeZone}));
    }

    private getNowInTimezone(timeZone: string) {
        return new Date(new Date().toLocaleString("en-US", {timeZone}));
    }

    private buildWeatherParams(location: Location, timeZone: string, startDate: string, hourlyWeatherValues: string[], dailyWeatherValues: string[]) {
        let params: Record<string, string | number | boolean> = {
            latitude: location.latitude,
            longitude: location.longitude,
            timezone: timeZone,
            current_weather: true,
            start_date: startDate,
            end_date: startDate,
        };

        if (hourlyWeatherValues.length > 0) {
            params.hourly = hourlyWeatherValues.join(",");
        }

        if (dailyWeatherValues.length > 0) {
            params.daily = dailyWeatherValues.join(",");
        }

        return params;
    }

    private buildAirQualityParams(location: Location, startDate: string, hourlyAirQualityValues: string[]) {
        let params: Record<string, string | number> = {
            latitude: location.latitude,
            longitude: location.longitude,
            start_date: startDate,
            end_date: startDate,
        };

        if (hourlyAirQualityValues.length > 0) {
            params.hourly = hourlyAirQualityValues.join(",");
        }

        return params;
    }

}

module.exports = WeatherDevice;
