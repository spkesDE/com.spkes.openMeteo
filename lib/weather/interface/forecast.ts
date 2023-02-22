import Day from "./day";
import Astro from "./astro";
import HourlyWeather from "./hourlyWeather";

export default interface Forecast {
    forecastday: ForecastDay[];
}

export interface ForecastDay {
    date:       Date;
    date_epoch: number;
    day:        Day;
    astro:      Astro;
    hour:       HourlyWeather[];
}
