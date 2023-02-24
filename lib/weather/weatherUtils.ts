import WeatherApi from "../../app";

export default class WeatherUtils {
    public static getCurrentWeather(app: WeatherApi): Promise<any> {
        return new Promise((resolve, reject) => {
            let endpoint = "current.json"
            app.api.get<any>(`${endpoint}?key=${app.token}&q=${app.location}&aqi=yes`).then((r) => {
                if(r.status == 200){
                    resolve(r.data);
                } else {
                    reject(`Failed to get weather. Status ${r.status}`);
                }
            }).catch((err) => reject(err));
        });
    }

    static async getForecast(app: WeatherApi, days: number): Promise<any> {
        return new Promise((resolve, reject) => {
            let endpoint = "forecast.json"
            if(days == 0 || days > 7) reject(new Error(`Failed to get forecast because days are out of range. Range: 1-7. Given: ${days} days`))
            app.api.get<any>(`${endpoint}?key=${app.token}&q=${app.location}&days=${days}&aqi=yes`).then((r) => {
                if(r.status == 200){
                    resolve(r.data);
                } else {
                    reject(`Failed to get weather. Status ${r.status}`);
                }
            }).catch((err) => reject(err));
        });
    }
}
