import "module-alias/register";
import Homey from 'homey';
import Location from "@/lib/weather/interface/location";
import OpenMeteo from "@/app";
import Forecast, {AirQualityForecast, CurrentWeather, OpenMeteoVariableMap} from "@/lib/weather/interface/forecast";
import {DeviceSettings} from "@/lib/weather/interface/settings";
import {buildAirQualityParams, buildWeatherParams} from "@/lib/weather/weatherApi";
import {capabilityMigrations, findLegacyCapabilityFor} from "@/lib/weather/weatherCapabilities";
import {
    findWeatherConfig,
    getApiValue,
    getConfiguredCapabilityIds,
    WeatherConfig,
    WeatherConfigSource,
} from "@/lib/weather/weatherConfig";
import {DeviceStore, NormalizedDeviceStore, WeatherFlowSnapshot} from "@/drivers/weather/types";
import Utils from "@/lib/utils";
import WeatherUnits, {WeatherUnitSystem} from "@/lib/weather/weatherUnits";
import {
    normalizeForecastDays,
    normalizeForecastHour,
    normalizeForecastHours,
    normalizeForecastMode,
    resolveForecastTarget,
} from "@/lib/weather/forecastTarget";
import {normalizeWeatherModel} from "@/lib/weather/weatherModels";

export default class WeatherDevice extends Homey.Device {
    private static readonly DEFAULT_TIME_FORMAT = "HH:mm";
    private updateInterval!: NodeJS.Timeout;
    private randomNumber: number = 15;
    private isUpdating: boolean = false;
    private isUninitializing: boolean = false;
    public latestWeatherReport?: Forecast;
    public latestAirQualityReport?: AirQualityForecast;

    async onInit() {
        this.randomNumber = Math.floor(Math.random() * (15 - 2 + 1) + 2);

        await this.migrateLegacyCapabilities();
        await this.ensureConfiguredCapabilitiesPresent();
        await this.applyUnitSystemCapabilityOptions();

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

            let target = resolveForecastTarget(store.timezone, store);
            let startDate = target.date;

            let weather = await this.getCurrentWeather(
                store.location,
                store.timezone,
                this.getRequestedHourlyWeatherVariables(store.hourlyWeatherVariables),
                store.dailyWeatherVariables,
                target.useCurrent
                    ? this.getRequestedCurrentWeatherVariables(store.hourlyWeatherVariables)
                    : [],
                startDate,
                store.weatherModel,
            );
            this.latestWeatherReport = weather;

            let targetHourIndex = this.getHourIndexForDateTime(weather.hourly?.time, target.dateTime);
            if (targetHourIndex < 0) {
                throw new Error(`No hourly weather forecast returned for ${this.getTargetHourKey(target.dateTime)}`);
            }
            await this.updateConfiguredWeatherValues(store, weather, targetHourIndex, target.useCurrent);
            await this.updateDateCapability(target.dateTime);
            await this.updateConfiguredAirQualityValues(
                store,
                store.location,
                startDate,
                target.dateTime,
                target.dayOffset,
                target.useCurrent,
            );
            await this.updateDerivedAlarmCapabilities();

            if (!this.isUninitializing) {
                await this.triggerFlowStateChanges(previousSnapshot, this.getFlowSnapshot());
                await this.homey.flow.getDeviceTriggerCard("weather-has-been-updated").trigger(this);
            }
            this.log(`Updating weather for location: ${store.location.name}`)
        } catch (err: any) {
            let store = this.getNormalizedStore();
            this.error(`Failed to update weather for ${this.getName()} (${store.location?.name ?? "unknown location"}): ${err?.message ?? err}`);
        } finally {
            this.isUpdating = false;
        }
    }

    public async updateWeather(weatherValue: string, weatherArray: OpenMeteoVariableMap | undefined, index: number = 0, source: WeatherConfigSource = "weather") {
        //Getting JSON entry of the weatherValue
        let config = this.getConfig(weatherValue, source);
        if (config === null) {
            this.error(`No config found for weather value "${weatherValue}" on ${this.getName()}`);
            return;
        }
        let capabilityId = this.resolveCapabilityId(config.capability);
        if (!capabilityId) return;

        if (config.value === "alarm_rain" || config.value === "alarm_freeze_risk") return;

        if (config.value == "weatherCondition") {
            let weatherCodes = weatherArray?.["weather_code"];
            if (!Array.isArray(weatherCodes)) {
                this.error(`Weather field "weather_code" is missing in API response for ${this.getName()} (requested by "${weatherValue}")`);
                return;
            }

            let safeIndex = Math.max(0, Math.min(index, weatherCodes.length - 1));
            let rawWmoCode = weatherCodes[safeIndex];
            let wmoCode = typeof rawWmoCode === "number" ? rawWmoCode : -1;
            await this.setCapabilityValue(capabilityId, this.homey.__(`wmo.${wmoCode}`) ?? `Unknown Weather (${wmoCode})`);
            return;
        }

        if (config.labelOf && config.labelScale) {
            let sourceValues = weatherArray?.[config.labelOf];
            if (!Array.isArray(sourceValues)) {
                this.error(`AQI field "${config.labelOf}" is missing in API response for ${this.getName()} (requested by "${weatherValue}")`);
                return;
            }
            let safeIndex = Math.max(0, Math.min(index, sourceValues.length - 1));
            let raw = sourceValues[safeIndex];
            let numericValue = typeof raw === "number" ? raw : -1;
            let label = config.labelScale === "european"
                ? this.getEuropeanAqiLabel(numericValue)
                : this.getUsAqiLabel(numericValue);
            await this.setCapabilityValue(capabilityId, label);
            return;
        }

        let apiValue = getApiValue(config);
        let values = weatherArray?.[apiValue];
        if (!Array.isArray(values)) {
            this.error(`Weather field "${apiValue}" is missing in API response for ${this.getName()} (requested by "${weatherValue}")`);
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
            let formattedTime = Utils.formatTimeValue(value, this.getTimeFormatSetting());
            if (!formattedTime) return;
            await this.setCapabilityValue(capabilityId, formattedTime);
            return;
        }
        if (config.value == "sunset") {
            let formattedTime = Utils.formatTimeValue(value, this.getTimeFormatSetting());
            if (!formattedTime) return;
            await this.setCapabilityValue(capabilityId, formattedTime);
            return;
        }
        //If number capability set value.
        let displayValue = typeof value === "number"
            ? WeatherUnits.convertDeviceCapabilityValue(this, capabilityId, value, this.getNormalizedStore().unitSystem)
            : value;
        await this.setCapabilityValue(capabilityId, displayValue ?? 0).catch((err) => this.error(err))
    }

    public getConfig(query: string, source?: WeatherConfigSource): WeatherConfig | null {
        return findWeatherConfig(query, source);
    }

    public getFlowSnapshot(): WeatherFlowSnapshot {
        let weather = this.latestWeatherReport;
        let airQuality = this.latestAirQualityReport;
        let hourly = weather?.hourly;
        let daily = weather?.daily;
        let airHourly = airQuality?.hourly;

        let store = this.getNormalizedStore();
        let target = store.timezone ? resolveForecastTarget(store.timezone, store) : undefined;
        let current = target?.useCurrent ? weather?.current : undefined;
        let airCurrent = target?.useCurrent ? airQuality?.current : undefined;
        let targetDateTime = target?.dateTime;
        let targetHourIndex = this.getHourIndexForDateTime(hourly?.time, targetDateTime);
        let temperature = this.getNumericCurrentValue(current, "temperature_2m")
            ?? this.getNumericSeriesValue(hourly, "temperature_2m", targetHourIndex);
        let temperatureMin = this.getNumericSeriesValue(daily, "temperature_2m_min", 0);
        let temperatureMax = this.getNumericSeriesValue(daily, "temperature_2m_max", 0);
        let precipitationProbabilityHourly = this.getNumericCurrentValue(current, "precipitation_probability")
            ?? this.getNumericSeriesValue(hourly, "precipitation_probability", targetHourIndex);
        let precipitationProbabilityDaily = this.getNumericSeriesValue(daily, "precipitation_probability_max", 0);
        let precipitationProbability = precipitationProbabilityHourly ?? precipitationProbabilityDaily ?? 0;
        let precipitationAmount = this.getNumericCurrentValue(current, "precipitation")
            ?? this.getNumericSeriesValue(hourly, "precipitation", targetHourIndex)
            ?? 0;
        let rainAmount = this.getNumericCurrentValue(current, "rain")
            ?? this.getNumericSeriesValue(hourly, "rain", targetHourIndex)
            ?? 0;
        let showersAmount = this.getNumericCurrentValue(current, "showers")
            ?? this.getNumericSeriesValue(hourly, "showers", targetHourIndex)
            ?? 0;
        let snowfallAmount = this.getNumericCurrentValue(current, "snowfall")
            ?? this.getNumericSeriesValue(hourly, "snowfall", targetHourIndex)
            ?? 0;
        let cloudCover = this.getNumericCurrentValue(current, "cloud_cover")
            ?? this.getNumericSeriesValue(hourly, "cloud_cover", targetHourIndex)
            ?? 0;
        let windSpeed = this.getNumericCurrentValue(current, "wind_speed_10m")
            ?? this.getNumericSeriesValue(hourly, "wind_speed_10m", targetHourIndex)
            ?? this.getNumericSeriesValue(daily, "wind_speed_10m_max", 0)
            ?? 0;
        let windGusts = this.getNumericCurrentValue(current, "wind_gusts_10m")
            ?? this.getNumericSeriesValue(hourly, "wind_gusts_10m", targetHourIndex)
            ?? this.getNumericSeriesValue(daily, "wind_gusts_10m_max", 0)
            ?? 0;
        let uvIndexMax = this.getNumericSeriesValue(daily, "uv_index_max", 0) ?? 0;
        let pm25 = this.getNumericCurrentValue(airCurrent, "pm2_5")
            ?? this.getNumericSeriesValue(airHourly, "pm2_5", targetHourIndex);
        let weatherCode = this.getNumericCurrentValue(current, "weather_code")
            ?? this.getNumericSeriesValue(hourly, "weather_code", targetHourIndex)
            ?? this.getNumericCurrentValue(weather?.current_weather, "weathercode")
            ?? -1;
        let conditionLabel = this.homey.__(`wmo.${weatherCode}`) ?? `Unknown Weather (${weatherCode})`;
        let severeReasons: string[] = [];
        let measurablePrecipitation = precipitationAmount >= 0.1
            || rainAmount >= 0.1
            || showersAmount >= 0.1
            || snowfallAmount >= 0.1;
        let rainLikely = measurablePrecipitation
            || (precipitationProbability >= 70 && this.isWetWeatherCode(weatherCode))
            || (precipitationProbability >= 85 && cloudCover >= 75);

        if (precipitationProbability >= 85) severeReasons.push("rain");
        if (windSpeed >= 60 || windGusts >= 80) severeReasons.push("wind");
        if ((temperatureMin ?? temperature ?? 0) <= -5) severeReasons.push("freeze");
        if (uvIndexMax >= 8) severeReasons.push("uv");
        if ((pm25 ?? 0) >= 55) severeReasons.push("air_quality");

        return {
            hasWeatherData: !!weather,
            conditionCode: weatherCode,
            conditionLabel,
            rainLikely,
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
        let config = this.getConfig(variable, "weatherDaily");
        let apiValue = config ? getApiValue(config) : variable;
        return this.latestWeatherReport?.daily?.[apiValue]?.[0];
    }

    public getComparableWeatherValue(variable: string, source?: WeatherConfigSource) {
        let config = this.getConfig(variable, source);
        if (!config?.capability) return null;

        let capabilityId = this.resolveCapabilityId(config.capability);
        if (!capabilityId || !this.hasCapability(capabilityId)) return null;

        let value = this.getCapabilityValue(capabilityId);
        return typeof value === "number" ? value : null;
    }

    public getUnitSystem(): WeatherUnitSystem {
        return this.getNormalizedStore().unitSystem;
    }

    public getUnitSystemForCapability(capabilityId: string): WeatherUnitSystem {
        return WeatherUnits.getDeviceCapabilityUnitSystem(this, capabilityId, this.getUnitSystem());
    }

    public async applyUnitSystemCapabilityOptions(force: boolean = false) {
        let unitSystem = this.getUnitSystem();
        let updates = await WeatherUnits.applyCapabilityOptions(this, unitSystem, force);
        if (updates > 0) {
            this.log(`Updated ${updates} capability unit option(s) to ${unitSystem}`);
        }
    }

    private getRequestedHourlyWeatherVariables(hourlyWeatherVariables: string[]) {
        let hourlyApiVars = hourlyWeatherVariables
            .map((variable) => this.getConfig(variable, "weather"))
            .filter((config): config is WeatherConfig => config?.apiVar === true)
            .map(getApiValue);
        if (hourlyWeatherVariables.includes("weatherCondition") && !hourlyApiVars.includes("weather_code")) {
            hourlyApiVars.push("weather_code");
        }
        return [...new Set(hourlyApiVars)];
    }

    private getRequestedCurrentWeatherVariables(hourlyWeatherVariables: string[]) {
        return [...new Set([
            ...this.getRequestedHourlyWeatherVariables(hourlyWeatherVariables),
            "weather_code",
        ])];
    }

    private getRequestedHourlyAirQualityVariables(hourlyAirQualityValues: string[]) {
        let aqiApiVars = hourlyAirQualityValues
            .map((variable) => this.getConfig(variable, "airQuality"))
            .filter((config): config is WeatherConfig => config?.apiVar === true)
            .map(getApiValue);
        for (let variable of hourlyAirQualityValues) {
            let config = this.getConfig(variable, "airQuality");
            if (config?.labelOf && !aqiApiVars.includes(config.labelOf)) {
                aqiApiVars.push(config.labelOf);
            }
        }
        return [...new Set(aqiApiVars)];
    }

    private async updateConfiguredWeatherValues(
        store: NormalizedDeviceStore,
        weather: Forecast,
        targetHourIndex: number,
        useCurrent: boolean,
    ) {
        for (let variable of store.dailyWeatherVariables) {
            await this.updateWeather(variable, weather.daily, 0, "weatherDaily");
        }

        let currentWeather = useCurrent
            ? this.currentWeatherToVariableMap(weather.current)
            : undefined;
        for (let variable of store.hourlyWeatherVariables) {
            let config = this.getConfig(variable, "weather");
            let apiValue = config ? getApiValue(config) : variable;
            let currentApiValue = variable === "weatherCondition" ? "weather_code" : apiValue;
            let hasCurrentValue = currentWeather?.[currentApiValue] !== undefined;
            await this.updateWeather(
                variable,
                hasCurrentValue ? currentWeather : weather.hourly,
                hasCurrentValue ? 0 : targetHourIndex,
                "weather",
            );
        }
    }

    private currentWeatherToVariableMap(current: CurrentWeather | undefined): OpenMeteoVariableMap | undefined {
        if (!current) return undefined;

        let result: OpenMeteoVariableMap = {};
        for (let [key, value] of Object.entries(current)) {
            if (value !== undefined) result[key] = [value];
        }
        return result;
    }

    private async updateConfiguredAirQualityValues(
        store: NormalizedDeviceStore,
        location: Location,
        startDate: string,
        targetDateTime: Date,
        targetDayOffset: number,
        useCurrent: boolean,
    ) {
        if (store.hourlyAirQualityValues.length === 0) {
            this.latestAirQualityReport = undefined;
            return;
        }

        if (targetDayOffset > 6) {
            this.latestAirQualityReport = undefined;
            this.log(`Skipping air quality for ${this.getName()}: Open-Meteo supports up to 7 forecast days`);
            return;
        }

        let requestedVariables = this.getRequestedHourlyAirQualityVariables(store.hourlyAirQualityValues);
        let airQuality = await this.getAirQuality(
            location,
            store.timezone!,
            requestedVariables,
            useCurrent ? requestedVariables : [],
            startDate,
        );
        this.latestAirQualityReport = airQuality;

        let targetHourIndex = this.getHourIndexForDateTime(airQuality.hourly?.time, targetDateTime);
        if (targetHourIndex < 0) {
            throw new Error(`No hourly air-quality forecast returned for ${this.getTargetHourKey(targetDateTime)}`);
        }

        let currentAirQuality = useCurrent
            ? this.currentWeatherToVariableMap(airQuality.current)
            : undefined;
        for (let variable of store.hourlyAirQualityValues) {
            let config = this.getConfig(variable, "airQuality");
            let apiValue = config?.labelOf ?? (config ? getApiValue(config) : variable);
            let hasCurrentValue = currentAirQuality?.[apiValue] !== undefined;
            await this.updateWeather(
                variable,
                hasCurrentValue ? currentAirQuality : airQuality.hourly,
                hasCurrentValue ? 0 : targetHourIndex,
                "airQuality",
            );
        }
    }

    private async updateDateCapability(targetDateTime: Date) {
        if (!this.hasCapability("date")) return;

        let hours = this.formatDateWithSetting(targetDateTime);
        let day = ("0" + targetDateTime.getUTCDate()).slice(-2) + "." + ("0" + (targetDateTime.getUTCMonth() + 1)).slice(-2) + "." + targetDateTime.getUTCFullYear();
        await this.setCapabilityValue("date", `${hours} ${day}`);
    }

    private async getCurrentWeather(
        location: Location,
        timeZone: string,
        hourlyWeatherValues: string[],
        dailyWeatherValues: string[],
        currentWeatherValues: string[],
        startDate: string,
        weatherModel: string,
    ): Promise<Forecast> {
        if (this.isUninitializing) {
            throw new Error("Device is shutting down");
        }

        let app = this.homey.app as OpenMeteo;
        return app.getApi()
            .get<Forecast>("", {
                params: buildWeatherParams(
                    location,
                    timeZone,
                    startDate,
                    hourlyWeatherValues,
                    dailyWeatherValues
                        .map((variable) => this.getConfig(variable, "weatherDaily"))
                        .filter((config): config is WeatherConfig => config?.apiVar === true)
                        .map(getApiValue),
                    currentWeatherValues,
                    weatherModel,
                )
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

    private async getAirQuality(
        location: Location,
        timeZone: string,
        hourlyAirQualityValues: string[],
        currentAirQualityValues: string[],
        startDate: string,
    ): Promise<AirQualityForecast> {
        if (this.isUninitializing) {
            throw new Error("Device is shutting down");
        }

        let app = this.homey.app as OpenMeteo;
        return app.getAirQualityApi()
            .get<AirQualityForecast>("", {
                params: buildAirQualityParams(
                    location,
                    timeZone,
                    startDate,
                    hourlyAirQualityValues,
                    currentAirQualityValues,
                )
            })
            .then((r) => {
                if (r.status == 200) {
                    return r.data;
                }
                throw new Error(`Failed to get air quality. Status ${r.status}`);
            }).catch((err) => {
                throw new Error(err?.message ?? String(err));
            });
    }

    async onUninit() {
        this.isUninitializing = true;
        this.clearUpdateInterval();
    }

    async onSettings({ newSettings, changedKeys }: { newSettings: DeviceSettings; changedKeys: string[]; }) {
        if (changedKeys.includes("time_format")) {
            this.validateTimeFormat(newSettings.time_format);
            await this.update(true);
        }
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

    private getNormalizedStore(): NormalizedDeviceStore {
        let store = this.getStore() as DeviceStore;
        return {
            location: store.location,
            timezone: store.timezone,
            forecast: normalizeForecastDays(store.forecast),
            forecastMode: normalizeForecastMode(store.forecastMode, store.forecast !== undefined),
            forecastHours: normalizeForecastHours(store.forecastHours),
            forecastHour: normalizeForecastHour(store.forecastHour),
            weatherModel: normalizeWeatherModel(store.weatherModel),
            unitSystem: WeatherUnits.normalize(
                store.unitSystem,
                store.windSpeedUnit,
                store.precipitationUnit,
            ),
            dailyWeatherVariables: this.normalizeStringArray(store.dailyWeatherVariables),
            hourlyWeatherVariables: this.normalizeStringArray(store.hourlyWeatherVariables),
            hourlyAirQualityValues: this.normalizeStringArray(store.hourlyAirQualityValues),
        };
    }

    private normalizeStringArray(values: string[] | undefined) {
        if (!Array.isArray(values)) return [];
        return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
    }

    private getHourIndexForDateTime(times?: Array<string | number | null>, targetDateTime?: Date) {
        return Utils.findHourIndexForDateTime(times, targetDateTime);
    }

    private getTargetHourKey(targetDateTime: Date) {
        return `${Utils.toIsoDate(targetDateTime)}T${String(targetDateTime.getUTCHours()).padStart(2, "0")}:00`;
    }

    private getNumericSeriesValue(data: OpenMeteoVariableMap | undefined, key: string, index: number) {
        let value = data?.[key]?.[index];
        return typeof value === "number" ? value : undefined;
    }

    private getNumericCurrentValue(data: CurrentWeather | undefined, key: string) {
        let value = data?.[key];
        return typeof value === "number" ? value : undefined;
    }

    private isWetWeatherCode(weatherCode: number) {
        return [
            51, 53, 55, 56, 57,
            61, 63, 65, 66, 67,
            71, 73, 75, 77,
            80, 81, 82, 85, 86,
            95, 96, 99,
        ].includes(weatherCode);
    }

    private async setBooleanCapabilityIfPresent(capability: string, value: boolean) {
        if (!this.hasCapability(capability)) return;
        await this.setCapabilityValue(capability, value).catch((err) => this.error(err));
    }

    private getEuropeanAqiLabel(value: number): string {
        if (value < 20) return this.homey.__("aqi.european.good");
        if (value < 40) return this.homey.__("aqi.european.fair");
        if (value < 60) return this.homey.__("aqi.european.moderate");
        if (value < 80) return this.homey.__("aqi.european.poor");
        if (value < 100) return this.homey.__("aqi.european.very_poor");
        return this.homey.__("aqi.european.extremely_poor");
    }

    private getUsAqiLabel(value: number): string {
        if (value <= 50) return this.homey.__("aqi.us.good");
        if (value <= 100) return this.homey.__("aqi.us.moderate");
        if (value <= 150) return this.homey.__("aqi.us.unhealthy_sensitive");
        if (value <= 200) return this.homey.__("aqi.us.unhealthy");
        if (value <= 300) return this.homey.__("aqi.us.very_unhealthy");
        return this.homey.__("aqi.us.hazardous");
    }

    private resolveCapabilityId(capability: string) {
        if (this.hasCapability(capability)) return capability;

        let legacyCapability = findLegacyCapabilityFor(capability);
        if (legacyCapability && this.hasCapability(legacyCapability)) {
            return legacyCapability;
        }

        return null;
    }

    private async migrateLegacyCapabilities() {
        for (let migration of capabilityMigrations) {
            await this.migrateLegacyCapability(migration.legacyCapability, migration.nextCapability);
        }
    }

    private async migrateLegacyCapability(legacyCapability: string, nextCapability: string) {
        if (!this.hasCapability(legacyCapability)) return;

        try {
            if (!this.hasCapability(nextCapability)) {
                await this.addCapability(nextCapability);
            }
            await this.removeCapability(legacyCapability);
        } catch (err: any) {
            this.error(`Failed to migrate capability "${legacyCapability}" to "${nextCapability}" on ${this.getName()}: ${err?.message ?? err}`);
        }
    }

    private async ensureConfiguredCapabilitiesPresent() {
        let addedConvertibleCapability = false;
        for (let capability of getConfiguredCapabilityIds(this.getNormalizedStore())) {
            if (this.resolveCapabilityId(capability)) continue;
            try {
                await this.addCapability(capability);
                addedConvertibleCapability ||= WeatherUnits.isConvertibleCapability(capability);
            } catch (err: any) {
                this.error(`Failed to add missing capability "${capability}" to ${this.getName()}: ${err?.message ?? err}`);
            }
        }
        if (addedConvertibleCapability) {
            await this.applyUnitSystemCapabilityOptions();
        }
    }

    private formatDateWithSetting(date: Date) {
        return Utils.formatTimeParts(this.getTimeFormatSetting(), {
            hour: date.getUTCHours(),
            minute: date.getUTCMinutes(),
            second: date.getUTCSeconds(),
        });
    }

    private getTimeFormatSetting() {
        let configuredFormat = this.getSetting("time_format");
        if (typeof configuredFormat !== "string" || !configuredFormat.trim()) {
            return WeatherDevice.DEFAULT_TIME_FORMAT;
        }
        return configuredFormat.trim();
    }

    private validateTimeFormat(format: string | undefined) {
        try {
            return Utils.validateTimeFormat(format);
        } catch (error: any) {
            let message = error?.message ?? "";
            if (message === "Time format is required") {
                throw new Error(this.homey.__("settings.time_format.errors.required"));
            }
            if (message === "Invalid time format") {
                throw new Error(this.homey.__("settings.time_format.errors.invalid"));
            }
            if (message === "Conflicting hour tokens") {
                throw new Error(this.homey.__("settings.time_format.errors.duplicate_hour"));
            }
            if (message === "Conflicting minute tokens") {
                throw new Error(this.homey.__("settings.time_format.errors.duplicate_minute"));
            }
            if (message === "Conflicting second tokens") {
                throw new Error(this.homey.__("settings.time_format.errors.duplicate_second"));
            }
            if (message === "Duplicate time tokens") {
                throw new Error(this.homey.__("settings.time_format.errors.duplicate_token"));
            }
            throw error;
        }
    }

}

module.exports = WeatherDevice;
