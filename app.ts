import Homey from 'homey';
import axios, {AxiosInstance} from 'axios';
import axiosRetry from "axios-retry";

export default class OpenMeteo extends Homey.App {
  private api!: AxiosInstance;
  private airQualityApi!: AxiosInstance;
  private isUninitializing: boolean = false;
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    let cloudId = await this.homey.cloud.getHomeyId();
    this.api = axios.create({
      baseURL: 'https://api.open-meteo.com/v1/forecast',
      timeout: 15000,
      headers: {
        "User-Agent": `HomeyPro/${this.manifest.version} - ${cloudId}`
      }
    });
    this.airQualityApi = axios.create({
      baseURL: 'https://air-quality-api.open-meteo.com/v1/air-quality',
      timeout: 15000,
      headers: {
        "User-Agent": `HomeyPro/${this.manifest.version} - ${cloudId}`
      }
    });
    axiosRetry(this.api , {
      retries: 4,
      retryDelay: (retryCount) => {
        if (this.isUninitializing) return 0;
        this.log("Failed to call api.open-meteo.com. Current retry attempt: " + retryCount);
        if(retryCount == 1) return 1000;
        if(retryCount == 2) return 1000 * 5;
        if(retryCount == 3) return 1000 * 10;
        return retryCount * 1000;
      },
      retryCondition: (error) => !this.isUninitializing && axiosRetry.isNetworkOrIdempotentRequestError(error)});
    axiosRetry(this.airQualityApi , {
      retries: 4,
      retryDelay: (retryCount) => {
        if (this.isUninitializing) return 0;
        this.log("Failed to call air-quality-api.open-meteo.com. Current retry attempt: " + retryCount);
        if(retryCount == 1) return 1000;
        if(retryCount == 2) return 1000 * 5;
        if(retryCount == 3) return 1000 * 10;
        return retryCount * 1000;
      },
      retryCondition: (error) => !this.isUninitializing && axiosRetry.isNetworkOrIdempotentRequestError(error)});
    this.log('OpenMeteo has been initialized');
  }

  public getApi(){
    if (this.isUninitializing) {
      throw new Error("App is shutting down");
    }
    return this.api;
  }

  public getAirQualityApi(){
    if (this.isUninitializing) {
      throw new Error("App is shutting down");
    }
    return this.airQualityApi;
  }

  async onUninit() {
    this.isUninitializing = true;
  }

}

module.exports = OpenMeteo;
