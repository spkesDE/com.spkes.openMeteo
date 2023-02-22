import WeatherApi from "../../app";
import CurrentWeather from "./currentWeather";
import ForecastWeather from "./forecastWeather";

export default class WeatherUtils {
    public static getCurrentWeather(app: WeatherApi): Promise<CurrentWeather> {
        return new Promise((resolve, reject) => {
            let endpoint = "current.json"
            app.api.get<CurrentWeather>(`${endpoint}?key=${app.token}&q=${app.location}&aqi=yes`).then((r) => {
                if(r.status == 200){
                    resolve(r.data);
                } else {
                    reject(`Failed to get weather. Status ${r.status}`);
                }
            }).catch((err) => reject(err));
        });
    }

    static async getForecast(app: WeatherApi, days: number): Promise<ForecastWeather> {
        return new Promise((resolve, reject) => {
            let endpoint = "forecast.json"
            if(days == 0 || days > 7) reject(new Error(`Failed to get forecast because days are out of range. Range: 1-7. Given: ${days} days`))
            app.api.get<ForecastWeather>(`${endpoint}?key=${app.token}&q=${app.location}&days=${days}&aqi=yes`).then((r) => {
                if(r.status == 200){
                    resolve(r.data);
                } else {
                    reject(`Failed to get weather. Status ${r.status}`);
                }
            }).catch((err) => reject(err));
        });
    }
}
