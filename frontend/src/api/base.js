import axios from "axios";
import { getToken } from "./auth";

const BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

export const BASE_URL = BASE + "/";

// Builds the full URL without a trailing slash when path is empty,
// and handles query-string paths (starting with "?") correctly.
const buildUrl = (client, path) => {
  if (!path) return `${BASE}/${client}/`;
  return `${BASE}/${client}/${path}`;
};

const buildHeaders = () => {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

export const reqClient = (method, url, options, client) => {
  const fullUrl = buildUrl(client, url);
  const headers = buildHeaders();
  switch (method) {
    case "GET":
      return axios.get(fullUrl, { headers });
    case "POST":
      return axios.post(fullUrl, options, { headers });
    case "PATCH":
      return axios.patch(fullUrl, options, { headers });
    case "DELETE":
      return axios.delete(fullUrl, { headers });
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
};
