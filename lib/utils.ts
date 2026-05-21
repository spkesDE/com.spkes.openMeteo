import Location from "./weather/interface/location";
import {DateParts, DateTimeParts, TimeParts} from "./weather/interface/time";

export default class Utils {
    public static hexToRGB(hex: string, alpha?: number) {
        let r = parseInt(hex.slice(1, 3), 16),
            g = parseInt(hex.slice(3, 5), 16),
            b = parseInt(hex.slice(5, 7), 16);

        if (alpha) {
            return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
        } else {
            return "rgb(" + r + ", " + g + ", " + b + ")";
        }
    }

    public static datasetVariables = {
        fill: true,
        borderWidth: 2,
        lineTension: 0.4,
        pointRadius: 0
    }

    public static optionVariables = {
        layout: {
            padding: {
                left: 10,
                right: 30,
                top: 20,
                bottom: 10
            }
        },
        legend: {
            display: false,
        },
    }

    public static scalesYVariables = {
        ticks: {
            beginAtZero: false,
        },
        gridLines: {
            display: true,
            color: 'rgba(125,125,125,0.2)',
            borderDash: [4, 4]
        },
    }

    public static scalesXVariables = {
        xAxes: [{
            gridLines: {
                display: false
            }
        }],
    }

    public static isValidLocation(location: Location | undefined) {
        return !!location
            && typeof location.name === "string"
            && typeof location.latitude === "number"
            && typeof location.longitude === "number"
            && typeof location.timezone === "string"
            && location.timezone.length > 0;
    }

    public static getDateTimePartsInTimeZone(timestamp: number, timeZone: string): DateTimeParts {
        let formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        let formattedParts = formatter.formatToParts(new Date(timestamp));
        let getPart = (type: Intl.DateTimeFormatPartTypes) => Number(formattedParts.find((part) => part.type === type)?.value ?? 0);
        return {
            year: getPart("year"),
            month: getPart("month"),
            day: getPart("day"),
            hour: getPart("hour"),
            minute: getPart("minute"),
            second: getPart("second"),
        };
    }

    public static getDatePartsInTimeZone(timestamp: number, timeZone: string, addDays: number): DateParts {
        let parts = Utils.getDateTimePartsInTimeZone(timestamp, timeZone);
        let baseDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + addDays));
        return {
            year: baseDate.getUTCFullYear(),
            month: baseDate.getUTCMonth() + 1,
            day: baseDate.getUTCDate(),
        };
    }

    public static createDateFromParts(parts: DateParts, timeParts?: Partial<TimeParts>) {
        return new Date(Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            timeParts?.hour ?? 0,
            timeParts?.minute ?? 0,
            timeParts?.second ?? 0,
        ));
    }

    public static toIsoDate(date: Date) {
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }

    public static getCurrentHourKey(timeZone: string) {
        let parts = Utils.getDateTimePartsInTimeZone(Date.now(), timeZone);
        return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}`;
    }

    public static findHourIndexForDateTime(times: Array<string | number | null> | undefined, targetDateTime: Date | undefined) {
        if (!Array.isArray(times) || times.length === 0 || !targetDateTime) return 0;
        let targetHourIso = `${Utils.toIsoDate(targetDateTime)}T${String(targetDateTime.getUTCHours()).padStart(2, "0")}`;
        let matchIndex = times.findIndex((time) => typeof time === "string" && time.startsWith(targetHourIso));
        return matchIndex >= 0 ? matchIndex : 0;
    }

    public static validateTimeFormat(format: string | undefined) {
        let trimmedFormat = typeof format === "string" ? format.trim() : "";
        if (!trimmedFormat) {
            throw new Error("Time format is required");
        }

        let tokenPattern = /(HH|H|mm|m|ss|s)/g;
        let matches = trimmedFormat.match(tokenPattern) ?? [];
        let stripped = trimmedFormat.replace(tokenPattern, "");
        if (matches.length === 0 || /[A-Za-z]/.test(stripped)) {
            throw new Error("Invalid time format");
        }

        let uniqueTokens = new Set(matches);
        if (uniqueTokens.has("H") && uniqueTokens.has("HH")) {
            throw new Error("Conflicting hour tokens");
        }
        if (uniqueTokens.has("m") && uniqueTokens.has("mm")) {
            throw new Error("Conflicting minute tokens");
        }
        if (uniqueTokens.has("s") && uniqueTokens.has("ss")) {
            throw new Error("Conflicting second tokens");
        }
        if (matches.length !== uniqueTokens.size) {
            throw new Error("Duplicate time tokens");
        }

        return trimmedFormat;
    }

    public static extractTimeParts(value: unknown): TimeParts | null {
        if (typeof value === "string") {
            let match = value.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
            if (match) {
                return {
                    hour: Number(match[1]),
                    minute: Number(match[2]),
                    second: Number(match[3] ?? 0),
                };
            }
        }
        if (typeof value !== "string" && typeof value !== "number") return null;
        let d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return {
            hour: d.getHours(),
            minute: d.getMinutes(),
            second: d.getSeconds(),
        };
    }

    public static formatTimeParts(format: string, parts: TimeParts) {
        let validFormat = Utils.validateTimeFormat(format);
        return validFormat
            .replace(/HH/g, String(parts.hour).padStart(2, "0"))
            .replace(/H/g, String(parts.hour))
            .replace(/mm/g, String(parts.minute).padStart(2, "0"))
            .replace(/m/g, String(parts.minute))
            .replace(/ss/g, String(parts.second).padStart(2, "0"))
            .replace(/s/g, String(parts.second));
    }

    public static formatTimeValue(value: unknown, format: string) {
        let parts = Utils.extractTimeParts(value);
        if (!parts) return null;
        return Utils.formatTimeParts(format, parts);
    }

}
