import Location from "./interface/location";
import Weather from "./interface/weather";
import Forecast from "./interface/forecast";

export default interface ForecastWeather extends Weather {
    forecast: Forecast;
}


