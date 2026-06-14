import { reqClient } from "./base";
import { clearToken, tryRefresh, ensureFreshToken } from "./auth";

export const request = async (client, url, method, options) => {
  // Proactively refresh the token if it expires within 2 minutes.
  await ensureFreshToken();

  const onSuccess = (response) => response;

  const onError = async (error) => {
    if (error?.response?.status === 401) {
      // Reactive fallback for clock skew or a race that slipped through.
      const newToken = await tryRefresh();
      if (newToken) {
        return reqClient(method, url, options, client).then(onSuccess);
      }
      clearToken();
      window.location.href = "/login";
      return Promise.reject(new Error("Session expired. Please log in again."));
    }
    if (error?.response?.status === 403) {
      return Promise.reject(new Error("Forbidden"));
    }
    return Promise.reject(error?.response || error);
  };

  return reqClient(method, url, options, client).then(onSuccess).catch(onError);
};

export const modelRequest = async ({ url, method, options }) =>
  request("models", url, method, options);
export const judgeRequest = async ({ url, method, options }) =>
  request("judge-models", url, method, options);
export const datasetRequest = async ({ url, method, options }) =>
  request("datasets", url, method, options);
export const experimentRequest = async ({ url, method, options }) =>
  request("experiments", url, method, options);
export const apiKeyRequest = async ({ url, method, options }) =>
  request("api-keys", url, method, options);
export const promptRequest = async ({ url, method, options }) =>
  request("prompts", url, method, options);
