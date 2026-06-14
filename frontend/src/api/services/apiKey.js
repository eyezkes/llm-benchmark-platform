import { apiKeyRequest } from "../request";

export default class ApiKeyService {
  static async getKeys() {
    return await apiKeyRequest({ url: "", method: "GET" });
  }
  static async createKey(data) {
    return await apiKeyRequest({ url: "", method: "POST", options: data });
  }
  static async deleteKey(id) {
    return await apiKeyRequest({ url: `${id}`, method: "DELETE" });
  }
}
