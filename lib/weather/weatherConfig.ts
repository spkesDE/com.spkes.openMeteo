import DailyWeatherVariablesConfig from "../../assets/json/dailyWeatherVariables.json";
import HourlyWeatherVariablesConfig from "../../assets/json/hourlyWeatherVariables.json";
import HourlyAirQualityVariablesConfig from "../../assets/json/hourlyAirQualityVariables.json";

export interface WeatherConfig {
    value: string;
    i18n: string;
    apiVar: boolean;
    default: boolean;
    capability: string;
    labelOf?: string;
    labelScale?: string;
}

export type WeatherConfigSource = "weather" | "weatherDaily" | "airQuality";

export interface WeatherVariableSelection {
    dailyWeatherVariables: string[];
    hourlyWeatherVariables: string[];
    hourlyAirQualityValues: string[];
}

const weatherConfigsBySource: Record<WeatherConfigSource, WeatherConfig[]> = {
    weather: HourlyWeatherVariablesConfig as WeatherConfig[],
    weatherDaily: DailyWeatherVariablesConfig as WeatherConfig[],
    airQuality: HourlyAirQualityVariablesConfig as WeatherConfig[],
};

export function getWeatherConfigs(source: WeatherConfigSource): WeatherConfig[] {
    return weatherConfigsBySource[source];
}

export function findWeatherConfig(query: string, source?: WeatherConfigSource): WeatherConfig | null {
    if (source) {
        return getWeatherConfigs(source).find((config) => config.value === query) ?? null;
    }

    for (let configSource of Object.keys(weatherConfigsBySource) as WeatherConfigSource[]) {
        let result = getWeatherConfigs(configSource).find((config) => config.value === query);
        if (result) return result;
    }

    return null;
}

export function getConfiguredCapabilityIds(selection: WeatherVariableSelection, baseCapabilities: string[] = ["date"]) {
    let capabilities = new Set(baseCapabilities);

    for (let config of getWeatherConfigs("weatherDaily")) {
        if (selection.dailyWeatherVariables.includes(config.value) && config.capability) {
            capabilities.add(config.capability);
        }
    }

    for (let config of getWeatherConfigs("weather")) {
        if (selection.hourlyWeatherVariables.includes(config.value) && config.capability) {
            capabilities.add(config.capability);
        }
    }

    for (let config of getWeatherConfigs("airQuality")) {
        if (selection.hourlyAirQualityValues.includes(config.value) && config.capability) {
            capabilities.add(config.capability);
        }
    }

    return [...capabilities];
}
