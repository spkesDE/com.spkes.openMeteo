import type Location from "@/lib/weather/interface/location";
import type WeatherDevice from "@/drivers/weather/device";
import type {WeatherConfigSource, WeatherVariableSelection} from "@/lib/weather/weatherConfig";
import type {WeatherUnitSystem} from "@/lib/weather/weatherUnits";
import type {ForecastMode} from "@/lib/weather/forecastTarget";

export interface DeviceStore extends Partial<WeatherVariableSelection> {
    location?: Location;
    timezone?: string;
    forecast?: number | string;
    forecastMode?: ForecastMode;
    forecastHours?: number | string;
    forecastHour?: number | string;
    unitSystem?: WeatherUnitSystem;
    tempUnit?: string;
    windSpeedUnit?: string;
    precipitationUnit?: string;
}

export interface NormalizedDeviceStore extends WeatherVariableSelection {
    location?: Location;
    timezone?: string;
    forecast: number;
    forecastMode: ForecastMode;
    forecastHours: number;
    forecastHour: number;
    unitSystem: WeatherUnitSystem;
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
    timezone?: string;
    unitSystem: WeatherUnitSystem;
    forecast: number;
    forecastMode: ForecastMode;
    forecastHours: number;
    forecastHour: number;
}

export type SessionStateStore = Partial<SessionState> & Pick<
    DeviceStore,
    "tempUnit" | "windSpeedUnit" | "precipitationUnit"
>;

export interface SessionViewRequest {
    view: "setup" | "dailyWeatherVariables" | "hourlyWeatherVariables" | "hourlyAirQualityValues";
}

export interface SetupPayload {
    location: Location;
    timezone: string;
    unitSystem: WeatherUnitSystem;
    forecast: number | string;
    forecastMode: ForecastMode;
    forecastHours: number | string;
    forecastHour: number | string;
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
