import { promptRequest } from "../request";

export default class PromptService {
  static async getPrompts(params = {}) {
    const q = new URLSearchParams();
    if (params.prompt_type) q.set("prompt_type", params.prompt_type);
    if (params.dataset_type) q.set("dataset_type", params.dataset_type);
    if (params.eval_type) q.set("eval_type", params.eval_type);
    const qs = q.toString();
    return promptRequest({ url: qs ? `?${qs}` : "", method: "GET" });
  }
  static async createPrompt(data) {
    return promptRequest({ url: "", method: "POST", options: data });
  }
  static async updatePrompt(id, data) {
    return promptRequest({ url: `${id}`, method: "PATCH", options: data });
  }
  static async deletePrompt(id) {
    return promptRequest({ url: `${id}`, method: "DELETE" });
  }
  static async generatePrompt(data) {
    return promptRequest({ url: "generate", method: "POST", options: data });
  }
}
