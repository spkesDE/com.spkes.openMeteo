export type OpenMeteoSeriesValue = number | string | null;

export interface OpenMeteoVariableMap {
    [key: string]: OpenMeteoSeriesValue[] | undefined;
}

export interface OpenMeteoUnitMap {
    [key: string]: string | undefined;
}

export interface CurrentWeather {
    temperature?: number;
    windspeed?: number;
    winddirection?: number;
    weathercode?: number;
    time?: string;
    [key: string]: number | string | undefined;
}

export default interface Forecast {
    latitude: number;
    longitude: number;
    generationtime_ms: number;
    utc_offset_seconds: number;
    timezone: string;
    timezone_abbreviation: string;
    elevation: number;
    current_weather?: CurrentWeather;
    hourly_units: OpenMeteoUnitMap;
    hourly: OpenMeteoVariableMap;
    daily_units: OpenMeteoUnitMap;
    daily: OpenMeteoVariableMap;
}

export interface AirQualityForecast {
    latitude: number;
    longitude: number;
    generationtime_ms: number;
    utc_offset_seconds?: number;
    timezone?: string;
    timezone_abbreviation?: string;
    elevation?: number;
    hourly_units: OpenMeteoUnitMap;
    hourly: OpenMeteoVariableMap;
}
