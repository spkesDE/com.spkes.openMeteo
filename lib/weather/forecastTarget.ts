import Utils from "@/lib/utils";

// Open-Meteo returns 16 calendar days including today (offset 0 through 15).
// 360 hours is the largest static relative offset that always stays within that range.
export const MAX_FORECAST_DAYS = 15;
export const MAX_FORECAST_HOURS = MAX_FORECAST_DAYS * 24;

export type ForecastMode = "relative_hours" | "day_hour" | "legacy_day";

export interface ForecastSchedule {
    forecastMode: ForecastMode;
    forecast: number;
    forecastHours: number;
    forecastHour: number;
}

export interface ForecastTarget {
    dateTime: Date;
    date: string;
    dayOffset: number;
    useCurrent: boolean;
}

export function normalizeForecastMode(value: unknown, hasLegacyForecast: boolean = false): ForecastMode {
    if (value === "relative_hours" || value === "day_hour" || value === "legacy_day") return value;
    return hasLegacyForecast ? "legacy_day" : "relative_hours";
}

export function normalizeForecastDays(value: unknown) {
    return normalizeInteger(value, 0, MAX_FORECAST_DAYS, 0);
}

export function normalizeForecastHours(value: unknown) {
    return normalizeInteger(value, 0, MAX_FORECAST_HOURS, 0);
}

export function normalizeForecastHour(value: unknown) {
    return normalizeInteger(value, 0, 23, 12);
}

export function resolveForecastTarget(
    timeZone: string,
    schedule: ForecastSchedule,
    timestamp: number = Date.now(),
): ForecastTarget {
    let nowParts = Utils.getDateTimePartsInTimeZone(timestamp, timeZone);
    let nowDate = Utils.createDateFromParts(nowParts);
    let targetDateTime: Date;
    let useCurrent = false;

    if (schedule.forecastMode === "relative_hours") {
        let targetParts = Utils.getDateTimePartsInTimeZone(
            timestamp + (schedule.forecastHours * 60 * 60 * 1000),
            timeZone,
        );
        useCurrent = schedule.forecastHours === 0;
        targetDateTime = Utils.createDateFromParts(targetParts, {
            hour: targetParts.hour,
            minute: useCurrent ? targetParts.minute : 0,
            second: useCurrent ? targetParts.second : 0,
        });
    } else {
        let targetDateParts = Utils.getDatePartsInTimeZone(timestamp, timeZone, schedule.forecast);
        useCurrent = schedule.forecastMode === "legacy_day" && schedule.forecast === 0;
        targetDateTime = Utils.createDateFromParts(targetDateParts, {
            hour: schedule.forecastMode === "day_hour" ? schedule.forecastHour : nowParts.hour,
            minute: useCurrent ? nowParts.minute : 0,
            second: useCurrent ? nowParts.second : 0,
        });
    }

    let targetDate = Utils.createDateFromParts({
        year: targetDateTime.getUTCFullYear(),
        month: targetDateTime.getUTCMonth() + 1,
        day: targetDateTime.getUTCDate(),
    });
    let dayOffset = Math.round((targetDate.getTime() - nowDate.getTime()) / (24 * 60 * 60 * 1000));

    return {
        dateTime: targetDateTime,
        date: Utils.toIsoDate(targetDateTime),
        dayOffset,
        useCurrent,
    };
}

function normalizeInteger(value: unknown, min: number, max: number, fallback: number) {
    let parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}
