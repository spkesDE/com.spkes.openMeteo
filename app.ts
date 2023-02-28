import Homey from 'homey';
import axios, {AxiosInstance} from 'axios';
import axiosRetry from "axios-retry";

export default class OpenMeteo extends Homey.App {
  private api!: AxiosInstance;
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    let cloudId = await this.homey.cloud.getHomeyId();
    this.api = axios.create({
      baseURL: 'https://api.open-meteo.com/v1/',
      timeout: 5000,
      headers: {
        "User-Agent": `HomeyPro/${this.manifest.version} - ${cloudId}`
      }
    });
    axiosRetry(this.api , {
      retries: 3,
      retryDelay: (retryCount) => {
        this.log("Failed to call open-meteo.com. Current retry attempt: " + retryCount);
        if(retryCount == 1) return 1000;
        if(retryCount == 2) return 1000 * 5;
        if(retryCount == 2) return 1000 * 10;
        return retryCount * 1000;
      },
      retryCondition: () => true});
    this.log('OpenMeteo has been initialized');
  }

  public getApi(){
    return this.api;
  }

}

module.exports = OpenMeteo;
