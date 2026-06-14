import { modelRequest } from "../request";

export const createModelConfig = {
  name: "",
  provider: "",
  model_name: "",
  base_url: "",
  api_key: "",
  system_prompt: "",
  params: {},
};

const toBackendShape = (model) => ({
  name: model.name ?? model.label,
  provider: model.vendor ?? model.provider,
  model_name: model.model_name ?? model.model,
  api_key: model.api_key ?? model.apiKey ?? null,
  user_api_key_id: model.user_api_key_id ?? null,
  base_url: (model.base_url ?? model.url) || undefined,
  system_prompt: model.system_prompt ?? model.prompt ?? null,
  params: model.params ?? {},
});

export default class ModelService {
  static async getModels() {
    return await modelRequest({ url: "", method: "GET" });
  }
  static async getModel(id) {
    return await modelRequest({ url: `${id}`, method: "GET" });
  }
  static async createModel(model) {
    return await modelRequest({ url: "", method: "POST", options: toBackendShape(model) });
  }
  static async updateModel(id, model) {
    return await modelRequest({ url: `${id}`, method: "PATCH", options: toBackendShape(model) });
  }
  static async deleteModel(id) {
    return await modelRequest({ url: `${id}`, method: "DELETE" });
  }
}