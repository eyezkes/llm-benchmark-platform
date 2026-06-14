import React from "react";
import {
  Autocomplete,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { VENDOR_LABELS, VENDOR_MODELS, VENDOR_PARAMS } from "../constants/modelConfig";

const ParamField = ({ param, value, onChange }) => {
  const label = param.required ? `${param.label} *` : param.label;

  if (param.type === "boolean") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.75 }}>
        <Switch
          size="small"
          checked={value ?? param.default ?? false}
          onChange={(e) => onChange(e.target.checked)}
        />
        <Typography variant="body2">{label}</Typography>
      </Box>
    );
  }

  if (param.type === "text") {
    return (
      <TextField
        label={label}
        type="text"
        size="small"
        fullWidth
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        helperText={param.helperText ?? ""}
      />
    );
  }

  if (param.type === "select") {
    return (
      <FormControl fullWidth size="small">
        <InputLabel>{label}</InputLabel>
        <Select
          value={value ?? ""}
          label={label}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {param.options.map((opt) => (
            <MenuItem key={opt} value={opt}>
              {opt}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  const helperText =
    param.min !== undefined && param.max !== undefined
      ? `${param.min} – ${param.max}`
      : "";

  return (
    <TextField
      label={label}
      type="number"
      size="small"
      fullWidth
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") { onChange(undefined); return; }
        onChange(param.type === "integer" ? parseInt(raw, 10) : parseFloat(raw));
      }}
      inputProps={{
        min: param.min,
        max: param.max,
        step: param.step ?? (param.type === "integer" ? 1 : 0.1),
      }}
      helperText={helperText}
    />
  );
};

export const ParamFields = ({ vendor, params, onParamChange }) => {
  const paramConfig = VENDOR_PARAMS[vendor] ?? [];
  if (paramConfig.length === 0) return null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" },
        gap: 2,
        alignItems: "start",
      }}
    >
      {paramConfig.map((param) => (
        <ParamField
          key={param.key}
          param={param}
          value={params[param.key]}
          onChange={(val) => onParamChange(param.key, val)}
        />
      ))}
    </Box>
  );
};

export const VendorModelSelector = ({ vendor, model, onVendorChange, onModelChange, baseUrl, disabled }) => {
  const [fetchedModels, setFetchedModels] = React.useState([]);
  const [fetching, setFetching] = React.useState(false);

  React.useEffect(() => {
    if (vendor !== "local" || !baseUrl?.trim()) {
      setFetchedModels([]);
      return;
    }
    const url = baseUrl.replace(/\/+$/, "");
    const modelsUrl = url.endsWith("/v1") ? `${url}/models` : `${url}/v1/models`;
    setFetching(true);
    fetch(modelsUrl)
      .then((r) => r.json())
      .then((data) => {
        const ids = (data?.data ?? []).map((m) => m.id).filter(Boolean);
        setFetchedModels(ids);
        if (ids.length === 1) onModelChange(ids[0]);
      })
      .catch(() => setFetchedModels([]))
      .finally(() => setFetching(false));
  }, [vendor, baseUrl]);

  return (
    <Stack spacing={2}>
      <FormControl fullWidth>
        <InputLabel>Vendor</InputLabel>
        <Select
          value={vendor}
          label="Vendor"
          onChange={(e) => onVendorChange(e.target.value)}
          disabled={disabled}
        >
          {Object.entries(VENDOR_LABELS).map(([key, label]) => (
            <MenuItem key={key} value={key}>
              {label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Autocomplete
        freeSolo
        disabled={disabled}
        options={vendor === "local" ? fetchedModels : (VENDOR_MODELS[vendor] ?? [])}
        value={model}
        inputValue={model}
        onInputChange={(_, newValue) => onModelChange(newValue)}
        onChange={(_, newValue) => onModelChange(newValue ?? "")}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Model"
            placeholder={vendor === "local" ? "e.g. llama3, mistral, phi3" : "Select or type a model name"}
            helperText={
              vendor === "local"
                ? fetching
                  ? "Fetching models from endpoint..."
                  : fetchedModels.length > 0
                  ? `${fetchedModels.length} model(s) found at endpoint.`
                  : "Enter the model name as served by your local endpoint."
                : "Choose from the list or type any model ID."
            }
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {fetching ? <CircularProgress size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />
    </Stack>
  );
};
