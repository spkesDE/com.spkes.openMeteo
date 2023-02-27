import Homey from 'homey';
import axios, {AxiosInstance} from 'axios';

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
    this.log('OpenMeteo has been initialized');
  }

  public getApi(){
    return this.api;
  }

}

module.exports = OpenMeteo;
