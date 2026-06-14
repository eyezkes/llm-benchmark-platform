import axios from "axios";
import { datasetRequest } from "../request";
import { BASE_URL } from "../base";
import { getToken } from "../auth";

// "True Answer" → open_with_true, "Multiple Choice" → mc_with_true, "Open Ended" → no_true_answer
const DATASET_TYPE_MAP = {
  "True Answer": "open_with_true",
  "Multiple Choice": "mc_with_true",
  "Open Ended": "no_true_answer",
};

// Returns the value if non-empty, otherwise undefined.
const val = (v) => (v && v.trim() ? v.trim() : undefined);

// Frontend column keys → backend role names
const toBackendColumns = (columns) => ({
  question:     val(columns.question),
  options:      val(columns.options),
  true_answer:  val(columns.true_answer) ?? val(columns.trueAnswer) ?? val(columns.answer),
  question_id:  val(columns.question_id),
  category:     val(columns.category),
});

export default class DatasetService {
  static async getDatasets() {
    return await datasetRequest({ url: "", method: "GET" });
  }
  static async getDataset(id) {
    return await datasetRequest({ url: `${id}`, method: "GET" });
  }
  // Accepts { name, datasetType, file, description }
  // datasetType may be a frontend label ("Multiple Choice") or a backend key ("mc_with_true")
  static async uploadDataset({ name, datasetType, file, description }) {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("dataset_type", DATASET_TYPE_MAP[datasetType] ?? datasetType);
    if (description) formData.append("description", description);
    formData.append("file", file);
    const token = getToken();
    return await axios.post(`${BASE_URL}datasets/upload`, formData, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }
  static async getColumns(id) {
    return await datasetRequest({ url: `${id}/columns`, method: "GET" });
  }
  // columns may use frontend keys (trueAnswer, answer) — normalized internally
  static async mapColumns(id, columns) {
    return await datasetRequest({
      url: `${id}/map`,
      method: "POST",
      options: toBackendColumns(columns),
    });
  }
  static async updateDataset(id, dataset) {
    return await datasetRequest({ url: `${id}`, method: "PATCH", options: dataset });
  }
  static async deleteDataset(id) {
    return await datasetRequest({ url: `${id}`, method: "DELETE" });
  }
  static async downloadDataset(id, name) {
    const token = getToken();
    const res = await fetch(`${BASE_URL}datasets/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Download failed.");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
