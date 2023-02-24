import Homey from 'homey';
import axios, {AxiosInstance} from 'axios';
import WeatherUtils from "./lib/weather/weatherUtils";

export default class OpenMeteo extends Homey.App {
  api!: AxiosInstance;
  token = "407b4865c3174419a0b161636232202";
  location = "Bad Oldesloe";

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.api = axios.create({
      baseURL: 'https://api.weatherapi.com/v1/',
      timeout: 5000,
    });
    let result = await WeatherUtils.getCurrentWeather(this);
    let forecast = await WeatherUtils.getForecast(this, 3);
    this.log(result.location.name);
    this.log(forecast.forecast.forecastday[0].hour[0].time);
    this.log('OpenMeteo has been initialized');
  }

}

module.exports = OpenMeteo;
