import {
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import React from "react";
import { LlmContext, LLMTYPES } from "../context/LlmContext";
import PromptPicker from "../components/PromptPicker";
import ModelService from "../api/services/model";
import ApiKeyService from "../api/services/apiKey";
import {
  ParamFields,
  VendorModelSelector,
} from "../components/VendorModelParams";
import { initParamDefaults } from "../constants/modelConfig";
import ErrorSnackbar from "../components/ErrorSnackbar";

const pageShellSx = {
  minHeight: "100vh",
  px: { xs: 2, md: 4 },
  py: { xs: 3, md: 5 },
  background:
    "radial-gradient(circle at top left, rgba(25,118,210,0.14), transparent 32%), radial-gradient(circle at top right, rgba(100,181,246,0.18), transparent 28%), linear-gradient(180deg, #f7fbff 0%, #eef4fb 100%)",
};

const frameSx = {
  maxWidth: 1120,
  mx: "auto",
  p: { xs: 2.5, md: 4 },
  borderRadius: 6,
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(244,248,252,0.98) 100%)",
  border: "1px solid rgba(25,118,210,0.12)",
  boxShadow: "0 26px 70px rgba(15, 23, 42, 0.08)",
};

const sectionCardSx = {
  p: { xs: 2, md: 3 },
  borderRadius: 4,
  border: "1px solid rgba(25,118,210,0.12)",
  boxShadow: "0 14px 35px rgba(15, 23, 42, 0.06)",
};

const actionButtonSx = {
  width: "fit-content",
  px: 3,
  py: 1.1,
  borderRadius: 999,
  textTransform: "none",
  fontWeight: 700,
};

const actionRowSx = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 2,
  flexWrap: "wrap",
};

const StageHeader = ({ eyebrow: _eyebrow, title, description }) => (
  <Stack spacing={1.25} sx={{ mb: 3 }}>
    <Typography
      variant="h3"
      sx={{
        fontSize: { xs: "2rem", md: "2.75rem" },
        fontWeight: 800,
        letterSpacing: "-0.03em",
        color: "#0f172a",
      }}
    >
      {title}
    </Typography>
    <Typography sx={{ maxWidth: 720, color: "text.secondary" }}>
      {description}
    </Typography>
  </Stack>
);

const AddModel = ({ setModels, onBack, updateLlms, initialData = null }) => {
  const isEdit = !!initialData;
  const [vendor, setVendor] = React.useState(initialData?.provider ?? "openai");
  const [model, setModel] = React.useState(initialData?.model_name ?? "");
  const [label, setLabel] = React.useState(initialData?.name ?? "");
  const [apiKey, setApiKey] = React.useState("");
  const [selectedKeyId, setSelectedKeyId] = React.useState(null);
  const [savedKeys, setSavedKeys] = React.useState([]);
  const [baseUrl, setBaseUrl] = React.useState(initialData?.base_url ?? "");
  const [systemPrompt, setSystemPrompt] = React.useState(initialData?.system_prompt ?? "");
  const [params, setParams] = React.useState(initialData?.params ?? initParamDefaults("openai"));

  React.useEffect(() => {
    if (!isEdit) {
      ApiKeyService.getKeys()
        .then((res) => setSavedKeys(res?.data ?? []))
        .catch(() => {});
    }
  }, [isEdit]);

  const handleVendorChange = (newVendor) => {
    setVendor(newVendor);
    setModel("");
    setParams(initParamDefaults(newVendor));
    setSelectedKeyId(null);
  };

  const handleParamChange = (key, value) => {
    setParams((prev) => {
      const next = { ...prev };
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    if (!label.trim() || !model) {
      setError("Please fill in Label and Model.");
      return;
    }
    if (!isEdit && !apiKey.trim() && !selectedKeyId && !baseUrl.trim()) {
      setError("Provide an API key, select a saved key, or provide a Base URL.");
      return;
    }
    if (!isEdit && vendor === "local" && !baseUrl.trim()) {
      setError("Base URL is required for local models.");
      return;
    }
    if (vendor === "anthropic" && !params.max_tokens) {
      setError("max_tokens is required for Anthropic models.");
      return;
    }
    setError("");
    const payload = isEdit
      ? { name: label, prompt: systemPrompt, params }
      : { name: label, label, model, prompt: systemPrompt, params, vendor };
    if (!isEdit) {
      if (selectedKeyId) {
        payload.user_api_key_id = selectedKeyId;
      } else {
        payload.apiKey = apiKey;
      }
      payload.url = baseUrl || null;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const res = await ModelService.updateModel(initialData.id, payload);
        const saved = res?.data ?? { ...initialData, ...payload };
        setModels((prev) => {
          const next = prev.map((m) => m.id === saved.id ? saved : m);
          updateLlms(LLMTYPES.MODEL, next);
          return next;
        });
      } else {
        const res = await ModelService.createModel(payload);
        const saved = res?.data ?? { name: label, model_name: model };
        setModels((prev) => {
          const next = [...prev, saved];
          updateLlms(LLMTYPES.MODEL, next);
          return next;
        });
      }
      onBack();
    } catch (err) {
      const detail = err?.data?.detail ?? err?.message ?? "Server error";
      setError(`Failed to save model: ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const lockedByRuns = isEdit && !!initialData?.has_runs;

  return (
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Models"
        title={isEdit ? `Edit "${initialData.name}"` : "Register a model endpoint"}
        description="Select a provider and model, fill in credentials, then tune the inference parameters."
      />
      {lockedByRuns && (
        <Typography sx={{ fontSize: "0.85rem", color: "warning.dark", bgcolor: "warning.50", border: "1px solid", borderColor: "warning.200", borderRadius: 2, px: 2, py: 1.25 }}>
          This model has experiment runs. Only the name can be changed to preserve result integrity.
        </Typography>
      )}

      {/* Row 1: Provider selector | Credentials */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" },
          gap: 3,
        }}
      >
        <Paper sx={sectionCardSx}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
            Provider
          </Typography>
          <VendorModelSelector
            vendor={vendor}
            model={model}
            onVendorChange={handleVendorChange}
            onModelChange={setModel}
            baseUrl={baseUrl}
            disabled={isEdit}
          />
        </Paper>

        <Paper
          sx={{
            ...sectionCardSx,
            background:
              "linear-gradient(180deg, rgba(248,251,255,1) 0%, rgba(237,246,255,1) 100%)",
          }}
        >
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
            Credentials &amp; Identity
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              fullWidth
              required
              helperText="The name used to identify this saved model."
            />
            {!isEdit && vendor !== "local" && (
              <Stack spacing={1}>
                <TextField
                  label="API Key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setSelectedKeyId(null); }}
                  fullWidth
                  autoComplete="off"
                  helperText={selectedKeyId ? `Using saved key: ${savedKeys.find((k) => k.id === selectedKeyId)?.label ?? savedKeys.find((k) => k.id === selectedKeyId)?.masked ?? ""}` : undefined}
                />
                {(() => {
                  const keysForVendor = savedKeys.filter((k) => k.vendor === vendor);
                  if (keysForVendor.length === 0) return null;
                  return (
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                      <Typography sx={{ fontSize: "0.75rem", color: "text.secondary", flexShrink: 0 }}>Saved:</Typography>
                      {keysForVendor.map((k) => (
                        <Chip
                          key={k.id}
                          label={k.label ? `${k.label} · ${k.masked}` : k.masked}
                          size="small"
                          variant={selectedKeyId === k.id ? "filled" : "outlined"}
                          color={selectedKeyId === k.id ? "primary" : "default"}
                          onClick={() => {
                            if (selectedKeyId === k.id) { setSelectedKeyId(null); }
                            else { setSelectedKeyId(k.id); setApiKey(""); }
                          }}
                          sx={{ borderRadius: 999, cursor: "pointer", fontSize: "0.75rem" }}
                        />
                      ))}
                    </Stack>
                  );
                })()}
              </Stack>
            )}
            {isEdit && (
              <TextField
                label="API Key"
                type="password"
                value=""
                fullWidth
                disabled
                placeholder="Cannot be changed after creation"
              />
            )}
            {(vendor === "local" || (isEdit && initialData?.base_url)) && (
              <TextField
                label="Base URL"
                value={isEdit ? (initialData?.base_url ?? "") : baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                fullWidth
                disabled={isEdit}
                placeholder="http://localhost:8000/v1 or https://..."
                helperText={isEdit ? "Cannot be changed after creation." : "Any OpenAI-compatible endpoint serving /v1/chat/completions."}
              />
            )}
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, color: "text.secondary", fontSize: "0.82rem" }}>System Prompt</Typography>
                <PromptPicker
                  promptType="model"
                  disabled={lockedByRuns}
                  onLoad={(content) => setSystemPrompt(content)}
                  onAppend={(content) => setSystemPrompt((prev) => prev ? `${prev}\n\n${content}` : content)}
                />
              </Stack>
              <TextField
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                fullWidth
                multiline
                disabled={lockedByRuns}
                minRows={3}
                placeholder="Enter system prompt or browse library..."
              />
              <Typography sx={{ fontSize: "0.75rem", color: "text.secondary", mt: 0.75 }}>
                Tip: You can also set a shared system prompt per experiment — it overrides each model's prompt for that run.
              </Typography>
            </Box>
          </Stack>
        </Paper>
      </Box>

      {/* Row 2: Inference parameters */}
      <Paper sx={sectionCardSx}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
          Parameters
        </Typography>
        <ParamFields
          vendor={vendor}
          params={params}
          onParamChange={lockedByRuns ? () => {} : handleParamChange}
        />
      </Paper>

      <ErrorSnackbar message={error} onClose={() => setError("")} />
      <Box sx={actionRowSx}>
        <Button variant="outlined" sx={actionButtonSx} onClick={onBack}>
          Back
        </Button>
        <Button variant="contained" sx={actionButtonSx} onClick={handleSubmit} disabled={saving}>
          {saving ? "Validating..." : isEdit ? "Save Changes" : "Save Model"}
        </Button>
      </Box>
    </Stack>
  );
};

const LIST_PAGE_SIZE = 6;

const ModelList = ({ models, onEdit, onDelete, onRename }) => {
  const [openId, setOpenId] = React.useState(null);
  const [renamingId, setRenamingId] = React.useState(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [renaming, setRenaming] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [searchQuery, setSearchQuery] = React.useState("");
  React.useEffect(() => { setPage(0); }, [searchQuery]);

  const sortedModels = React.useMemo(
    () => [...models].sort((a, b) => (a.has_runs ? 1 : 0) - (b.has_runs ? 1 : 0)),
    [models]
  );

  const filteredModels = React.useMemo(() => {
    if (!searchQuery.trim()) return sortedModels;
    const q = searchQuery.toLowerCase();
    return sortedModels.filter(
      (m) => m.name?.toLowerCase().includes(q) || m.provider?.toLowerCase().includes(q)
    );
  }, [sortedModels, searchQuery]);

  const paginated = filteredModels.length > LIST_PAGE_SIZE;
  const pageCount = Math.ceil(filteredModels.length / LIST_PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleModels = paginated
    ? filteredModels.slice(safePage * LIST_PAGE_SIZE, (safePage + 1) * LIST_PAGE_SIZE)
    : filteredModels;

  const startRename = (e, item) => {
    e.stopPropagation();
    setRenamingId(item.id);
    setRenameValue(item.name);
  };

  const cancelRename = (e) => {
    e?.stopPropagation();
    setRenamingId(null);
  };

  const submitRename = async (e, item) => {
    e.stopPropagation();
    if (!renameValue.trim() || renameValue === item.name) { cancelRename(); return; }
    setRenaming(true);
    try {
      const res = await ModelService.updateModel(item.id, { name: renameValue.trim() });
      onRename(item.id, renameValue.trim(), res?.data);
      setRenamingId(null);
    } catch {
      // keep dialog open on error
    } finally {
      setRenaming(false);
    }
  };

  if (models.length === 0) {
    return <Typography sx={{ color: "text.secondary" }}>No models saved yet.</Typography>;
  }

  return (
    <>
    <TextField
      size="small"
      placeholder="Search by name or provider…"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      fullWidth
      sx={{ mb: 1.5 }}
    />
    <List sx={{ p: 0 }}>
      {visibleModels.length === 0 && searchQuery.trim() && (
        <ListItem sx={{ px: 0 }}>
          <ListItemText primary="No models match your search." />
        </ListItem>
      )}
      {visibleModels.map((item) => {
        const id = item.id ?? item.name;
        const isOpen = openId === id;
        const isRenaming = renamingId === id;
        const params = item.params ?? {};
        const filledParams = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "");
        const hasParams = filledParams.length > 0;

        return (
          <Box key={id} sx={{ borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
            <ListItem
              sx={{ px: 0, py: 1.25, cursor: "pointer" }}
              onClick={() => !isRenaming && setOpenId(isOpen ? null : id)}
            >
              {isRenaming ? (
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", flex: 1 }} onClick={(e) => e.stopPropagation()}>
                  <TextField
                    size="small"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitRename(e, item); if (e.key === "Escape") cancelRename(e); }}
                    autoFocus
                    sx={{ flex: 1 }}
                  />
                  <Button size="small" variant="contained" disabled={renaming} onClick={(e) => submitRename(e, item)}>Save</Button>
                  <Button size="small" variant="outlined" onClick={cancelRename}>Cancel</Button>
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flex: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: item.has_runs ? "success.main" : "action.disabled" }} title={item.has_runs ? "Locked — has completed runs" : "Editable"} />
                  <ListItemText
                    primary={<Typography sx={{ fontWeight: 600 }}>{item.name}</Typography>}
                    secondary={[item.provider, item.model_name].filter(Boolean).join(" · ")}
                  />
                </Box>
              )}
              <Typography sx={{ fontSize: "0.8rem", color: "text.secondary", ml: 1 }}>
                {isOpen ? "▲" : "▼"}
              </Typography>
            </ListItem>

            <Collapse in={isOpen} unmountOnExit>
              <Stack spacing={1.5} sx={{ pb: 2, px: 0.5 }}>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {item.provider && <Chip label={item.provider} size="small" variant="outlined" />}
                  {item.model_name && <Chip label={item.model_name} size="small" variant="outlined" />}
                  {item.base_url && <Chip label={item.base_url} size="small" variant="outlined" />}
                </Stack>

                {item.system_prompt && (
                  <Box>
                    <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }}>
                      System Prompt
                    </Typography>
                    <Box sx={{ p: 1.5, borderRadius: 2, background: "rgba(15,23,42,0.04)", border: "1px solid rgba(15,23,42,0.08)", fontFamily: "monospace", fontSize: "0.8rem", whiteSpace: "pre-wrap", maxHeight: 120, overflowY: "auto" }}>
                      {item.system_prompt}
                    </Box>
                  </Box>
                )}

                {hasParams && (
                  <Box>
                    <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.75 }}>
                      Parameters
                    </Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                      {filledParams.map(([k, v]) => (
                        <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }} />
                      ))}
                    </Box>
                  </Box>
                )}

                <Stack direction="row" spacing={1}>
                  {item.has_runs ? (
                    <Button
                      size="small"
                      variant="outlined"
                      sx={{ textTransform: "none", borderRadius: 999, width: "fit-content" }}
                      onClick={(e) => startRename(e, item)}
                    >
                      Rename
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="outlined"
                      sx={{ textTransform: "none", borderRadius: 999, width: "fit-content" }}
                      onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                    >
                      Edit
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    sx={{ textTransform: "none", borderRadius: 999, width: "fit-content" }}
                    onClick={(e) => { e.stopPropagation(); onDelete(item); }}
                  >
                    Delete
                  </Button>
                </Stack>
              </Stack>
            </Collapse>
          </Box>
        );
      })}
    </List>
    {paginated && (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, pt: 1.5 }}>
        <IconButton size="small" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Typography sx={{ fontSize: "0.8rem", color: "text.secondary", minWidth: 60, textAlign: "center" }}>
          {safePage + 1} / {pageCount}
        </Typography>
        <IconButton size="small" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage === pageCount - 1}>
          <ChevronRightIcon fontSize="small" />
        </IconButton>
      </Box>
    )}
    </>
  );
};

const Models = () => {
  const [view, setView] = React.useState("list");
  const [editingModel, setEditingModel] = React.useState(null);
  const { updateLlms, llms } = React.useContext(LlmContext);
  const [models, setModels] = React.useState(llms.models ?? []);
  const [deleteError, setDeleteError] = React.useState("");

  React.useEffect(() => {
    ModelService.getModels()
      .then((res) => {
        const apiModels = res?.data ?? [];
        if (apiModels.length > 0) {
          setModels(apiModels);
          updateLlms(LLMTYPES.MODEL, apiModels);
        }
      })
      .catch(() => {});
  }, []);

  const handleEdit = (model) => { setEditingModel(model); setView("edit"); };
  const handleBack = () => { setEditingModel(null); setView("list"); };
  const handleRename = (id, newName, updated) => {
    const next = models.map((m) => (m.id ?? m.name) === id ? { ...m, name: newName, ...(updated ?? {}) } : m);
    setModels(next);
    updateLlms(LLMTYPES.MODEL, next);
  };
  const handleDelete = async (model) => {
    const id = model.id ?? model.name;
    try {
      await ModelService.deleteModel(id);
      const updated = models.filter((m) => (m.id ?? m.name) !== id);
      setModels(updated);
      updateLlms(LLMTYPES.MODEL, updated);
    } catch (err) {
      const detail = err?.data?.detail ?? err?.message ?? "Server error";
      setDeleteError(`Failed to delete model: ${detail}`);
    }
  };

  return (
    <Box sx={pageShellSx}>
      <Paper sx={frameSx}>
        {view === "add" && (
          <AddModel setModels={setModels} onBack={handleBack} updateLlms={updateLlms} />
        )}
        {view === "edit" && (
          <AddModel setModels={setModels} onBack={handleBack} updateLlms={updateLlms} initialData={editingModel} />
        )}
        {view === "list" && (
          <Stack spacing={3}>
          <ErrorSnackbar message={deleteError} onClose={() => setDeleteError("")} />
            <StageHeader
              eyebrow="Models"
              title="Saved model configurations"
              description="Save and manage model endpoints for use across your experiments."
            />
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1.15fr 0.85fr" }, gap: 3, alignItems: "start" }}>
              <Paper sx={sectionCardSx}>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>Saved Models</Typography>
                <ModelList models={models ?? []} onEdit={handleEdit} onDelete={handleDelete} onRename={handleRename} />
              </Paper>
              <Paper sx={{ ...sectionCardSx, background: "linear-gradient(135deg, rgba(25,118,210,0.12) 0%, rgba(144,202,249,0.1) 100%)" }}>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>Add a new model</Typography>
                <Typography sx={{ color: "text.secondary", mb: 3 }}>
                  Connect a model endpoint with its API credentials and inference parameters.
                </Typography>
                <Box sx={{ display: "flex", justifyContent: "center" }}>
                  <Button variant="contained" sx={actionButtonSx} onClick={() => setView("add")}>
                    Add Model
                  </Button>
                </Box>
              </Paper>
            </Box>
          </Stack>
        )}
      </Paper>
    </Box>
  );
};

export default Models;
