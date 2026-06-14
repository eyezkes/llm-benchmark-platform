import { experimentRequest } from "../request";

const toBackendShape = (experiment) => {
  const judgeConfigs = experiment.judge_configs
    ?? (experiment.judge
      ? [{
          judge_type: experiment.judge.judgeType,
          judge_model_id: experiment.judge.judgeModelId ?? null,
        }]
      : []);

  return {
    name: experiment.name,
    description: experiment.description ?? null,
    system_prompt_override: experiment.system_prompt_override ?? null,
    dataset_id: experiment.dataset_id ?? experiment.datasetId,
    candidate_model_ids: experiment.candidate_model_ids ?? experiment.candidateModelIds ?? [],
    judge_configs: judgeConfigs,
    sample_size: experiment.sample_size ?? experiment.sampleSize ?? 50,
    seed: experiment.seed ?? 42,
    measure_k: experiment.measure_k ?? experiment.measureK ?? 0,
  };
};

export default class ExperimentService {
  static async getExperiments(statusFilter) {
    const url = statusFilter ? `?status_filter=${statusFilter}` : "";
    return await experimentRequest({ url, method: "GET" });
  }
  static async getExperiment(id) {
    return await experimentRequest({ url: `${id}`, method: "GET" });
  }
  static async createExperiment(experiment) {
    return await experimentRequest({ url: "", method: "POST", options: toBackendShape(experiment) });
  }
  static async runExperiment(id) {
    return await experimentRequest({ url: `${id}/run`, method: "POST", options: {} });
  }
  static async updateExperiment(id, experiment) {
    return await experimentRequest({ url: `${id}`, method: "PATCH", options: experiment });
  }
  static async deleteExperiment(id) {
    return await experimentRequest({ url: `${id}`, method: "DELETE" });
  }
  static async addModel(experimentId, modelId) {
    return await experimentRequest({
      url: `${experimentId}/models/${modelId}`,
      method: "POST",
      options: {},
    });
  }
  static async removeModel(experimentId, modelId) {
    return await experimentRequest({
      url: `${experimentId}/models/${modelId}`,
      method: "DELETE",
    });
  }
  static async resetExperiment(id) {
    return await experimentRequest({ url: `${id}/reset`, method: "POST", options: {} });
  }
  static async cancelRun(experimentId, runId) {
    return await experimentRequest({
      url: `${experimentId}/runs/${runId}/cancel`,
      method: "POST",
      options: {},
    });
  }
  static async analyzeExperiment(experimentId, modelId) {
    return await experimentRequest({
      url: `${experimentId}/analyze`,
      method: "POST",
      options: { model_id: modelId },
    });
  }
}
