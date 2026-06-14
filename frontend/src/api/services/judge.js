import { judgeRequest } from "../request";

const toBackendShape = (judge) => {
  const mode = judge.mode ?? judge.type?.[0] ?? "boolean";

  let params = judge.params ?? {};
  if (typeof params === "string") {
    params = params.trim() ? JSON.parse(params.replaceAll("'", '"')) : {};
  }

  const base = {
    name: judge.name,
    provider: judge.provider ?? judge.vendor ?? "",
    model_name: judge.model_name ?? judge.model ?? "",
    api_key: judge.api_key ?? judge.apiKey ?? null,
    user_api_key_id: judge.user_api_key_id ?? null,
    base_url: judge.base_url ?? null,
    system_prompt: judge.system_prompt ?? "",
    mode,
    params,
  };

  if (mode === "score") {
    base.score_min = judge.score_min ?? 1;
    base.score_max = judge.score_max ?? 10;
  } else {
    base.correct_tokens = judge.correct_tokens ?? ["correct", "yes", "true"];
    base.incorrect_tokens = judge.incorrect_tokens ?? ["incorrect", "no", "false"];
  }

  return base;
};

export default class JudgeService {
  static async getJudges() {
    return await judgeRequest({ url: "", method: "GET" });
  }
  static async getJudge(id) {
    return await judgeRequest({ url: `${id}`, method: "GET" });
  }
  static async createJudge(judge) {
    return await judgeRequest({ url: "", method: "POST", options: toBackendShape(judge) });
  }
  static async updateJudge(id, judge) {
    return await judgeRequest({ url: `${id}`, method: "PATCH", options: toBackendShape(judge) });
  }
  static async deleteJudge(id) {
    return await judgeRequest({ url: `${id}`, method: "DELETE" });
  }
}
