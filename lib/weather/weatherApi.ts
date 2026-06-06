import type Location from "./interface/location";

export function buildWeatherParams(
    location: Location,
    timeZone: string,
    startDate: string,
    hourlyWeatherValues: string[],
    dailyWeatherValues: string[],
) {
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

export function buildAirQualityParams(location: Location, startDate: string, hourlyAirQualityValues: string[]) {
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
