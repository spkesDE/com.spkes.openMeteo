import WeatherApi from "../../app";
import Location from "./interface/location";

export default class WeatherUtils {
    public static getCurrentWeather(app: WeatherApi, location: Location, hourlyWeatherValues: any): Promise<any> {
        return new Promise((resolve, reject) => {
            let endpoint = "forecast"
            app.api.get<any>(`${endpoint}
            ?latitude=${location.latitude}&
            longitude=${location.longitude}&
            hourly=temperature_2m,precipitation_probability,precipitation,rain,showers,snowfall,snow_depth
            &models=best_match`).then((r) => {
                if(r.status == 200){
                    resolve(r.data);
                } else {
                    reject(`Failed to get weather. Status ${r.status}`);
                }
            }).catch((err) => reject(err));
        });
    }

    static async getForecast(app: WeatherApi,  location: Location, hourlyWeatherValues: any, days: number): Promise<any> {
        return new Promise((resolve, reject) => {
            let endpoint = "forecast"
            if(days == 0 || days > 7) reject(new Error(`Failed to get forecast because days are out of range. Range: 1-7. Given: ${days} days`))
            app.api.get<any>(`${endpoint}
            ?latitude=${location.latitude}&
            longitude=${location.longitude}&
            &hourly=temperature_2m,precipitation_probability,precipitation,rain,showers,snowfall,snow_depth
            &models=best_match
            &start_date=2023-02-27
            &end_date=2023-03-06`).then((r) => {
                if(r.status == 200){
                    resolve(r.data);
                } else {
                    reject(`Failed to get weather. Status ${r.status}`);
                }
            }).catch((err) => reject(err));
        });
    }
}
