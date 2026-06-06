import type Location from "../../lib/weather/interface/location";
import type WeatherDevice from "./device";
import type {WeatherConfigSource, WeatherVariableSelection} from "../../lib/weather/weatherConfig";

export interface DeviceStore extends Partial<WeatherVariableSelection> {
    location?: Location;
    timezone?: string;
    forecast?: number | string;
}

export interface NormalizedDeviceStore extends WeatherVariableSelection {
    location?: Location;
    timezone?: string;
    forecast: number;
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

export interface SessionState extends WeatherVariableSelection {
    location?: Location;
    tempUnit?: string;
    windSpeedUnit?: string;
    timezone?: string;
    precipitationUnit?: string;
    forecast: number;
}

export type SessionStateStore = Partial<SessionState>;

export interface SessionViewRequest {
    view: "setup" | "dailyWeatherVariables" | "hourlyWeatherVariables" | "hourlyAirQualityValues";
}

export interface SetupPayload {
    location: Location;
    tempUnit: string;
    windSpeedUnit: string;
    timezone: string;
    precipitationUnit: string;
    forecast: number;
}

export interface ChartVariableArgument {
    id: string;
    name: string;
    description?: string;
    type: WeatherConfigSource;
}

export interface CreateChartFlowArgs {
    device: WeatherDevice;
    weatherVariable: ChartVariableArgument;
    type?: string;
    period?: string;
    lineColor: string;
    backgroundColor: string;
}

export interface ForecastConditionArgs {
    device: WeatherDevice;
    weatherVariable: ChartVariableArgument;
    operator: "gt" | "gte" | "lt" | "lte" | "eq";
    value: number;
}
