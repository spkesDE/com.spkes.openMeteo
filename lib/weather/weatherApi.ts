import type Location from "@/lib/weather/interface/location";

export function buildWeatherParams(
    location: Location,
    timeZone: string,
    startDate: string,
    hourlyWeatherValues: string[],
    dailyWeatherValues: string[],
    currentWeatherValues: string[],
    weatherModel?: string,
) {
    let params: Record<string, string | number | boolean> = {
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: timeZone,
        start_date: startDate,
        end_date: startDate,
    };

    if (hourlyWeatherValues.length > 0) {
        params.hourly = hourlyWeatherValues.join(",");
    }

    if (dailyWeatherValues.length > 0) {
        params.daily = dailyWeatherValues.join(",");
    }

    if (currentWeatherValues.length > 0) {
        params.current = currentWeatherValues.join(",");
    }

    if (weatherModel && weatherModel !== "best_match") {
        params.models = weatherModel;
    }

    return params;
}

export function buildAirQualityParams(
    location: Location,
    timeZone: string,
    startDate: string,
    hourlyAirQualityValues: string[],
    currentAirQualityValues: string[],
) {
    let params: Record<string, string | number> = {
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: timeZone,
        start_date: startDate,
        end_date: startDate,
    };

    if (hourlyAirQualityValues.length > 0) {
        params.hourly = hourlyAirQualityValues.join(",");
    }

    if (currentAirQualityValues.length > 0) {
        params.current = currentAirQualityValues.join(",");
    }

    return params;
}
