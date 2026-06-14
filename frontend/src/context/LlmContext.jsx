import React, { createContext } from "react";

export const LlmContext = createContext({
  llms: { models: [], judges: [] },
  updateLlms: () => {},
});

const CACHE_KEY = "wabs_llm_cache";

const readCache = () => {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      models: parsed.models ?? [],
      judges: parsed.judges ?? [],
    };
  } catch {
    return null;
  }
};

const LlmContextProvider = ({ children }) => {
  const [llms, setLms] = React.useState(() => readCache() ?? { models: [], judges: [] });

  const updateLlms = React.useCallback((type, data) => {
    setLms((prev) => {
      const next = { ...prev, [type]: data };
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <LlmContext.Provider value={{ llms, updateLlms }}>
      {children}
    </LlmContext.Provider>
  );
};

export const LLMTYPES = {
  MODEL: "models",
  JUDGE: "judges",
};

export const LLM_CACHE_KEY = CACHE_KEY;

export default LlmContextProvider;
