export interface TimeParts {
    hour: number;
    minute: number;
    second: number;
}

export interface DateParts {
    year: number;
    month: number;
    day: number;
}

export interface DateTimeParts extends DateParts, TimeParts {}
