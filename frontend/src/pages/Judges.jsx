import {
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import React from "react";
import { LlmContext, LLMTYPES } from "../context/LlmContext";
import JudgeService from "../api/services/judge";
import PromptPicker from "../components/PromptPicker";
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

const JUDGE_MODES = ["boolean", "score"];
const JUDGE_MODE_LABELS = { boolean: "LLM Binary", score: "LLM Scoring" };

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

const AddJudge = ({ setJudges, onBack, updateLlms, initialData = null }) => {
  const isEdit = !!initialData;
  const [vendor, setVendor] = React.useState(initialData?.provider ?? "openai");
  const [model, setModel] = React.useState(initialData?.model_name ?? "");
  const [name, setName] = React.useState(initialData?.name ?? "");
  const [apiKey, setApiKey] = React.useState("");
  const [selectedKeyId, setSelectedKeyId] = React.useState(null);
  const [savedKeys, setSavedKeys] = React.useState([]);
  const [baseUrl, setBaseUrl] = React.useState(initialData?.base_url ?? "");
  const [systemPrompt, setSystemPrompt] = React.useState(
    initialData?.system_prompt ?? "",
  );
  const [mode, setMode] = React.useState(initialData?.mode ?? "boolean");
  const [scoreMin, setScoreMin] = React.useState(
    String(initialData?.score_min ?? "1"),
  );
  const [scoreMax, setScoreMax] = React.useState(
    String(initialData?.score_max ?? "10"),
  );
  const [correctTokens, setCorrectTokens] = React.useState(
    (initialData?.correct_tokens ?? ["correct", "yes", "true"]).join(", "),
  );
  const [incorrectTokens, setIncorrectTokens] = React.useState(
    (initialData?.incorrect_tokens ?? ["incorrect", "no", "false"]).join(", "),
  );
  const [params, setParams] = React.useState(
    initialData?.params ?? initParamDefaults("openai"),
  );

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

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Please add a judge name.");
      return;
    }
    if (!isEdit && !apiKey.trim() && !selectedKeyId && !baseUrl.trim()) {
      setError("Provide an API key, select a saved key, or provide a Base URL.");
      return;
    }
    if (vendor === "anthropic" && !params.max_tokens) {
      setError("max_tokens is required for Anthropic models.");
      return;
    }
    if (mode === "score") {
      const min = parseFloat(scoreMin),
        max = parseFloat(scoreMax);
      if (isNaN(min) || isNaN(max) || min >= max) {
        setError("Score min must be less than score max.");
        return;
      }
    }
    setError("");
    const judgeData = {
      name,
      system_prompt: systemPrompt,
      mode,
      model,
      vendor,
      params,
      ...(!isEdit ? { apiKey: selectedKeyId ? null : apiKey, user_api_key_id: selectedKeyId ?? null, base_url: baseUrl || null } : {}),
      ...(mode === "score"
        ? { score_min: parseFloat(scoreMin), score_max: parseFloat(scoreMax) }
        : {
            correct_tokens: correctTokens
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            incorrect_tokens: incorrectTokens
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          }),
    };
    try {
      if (isEdit) {
        const res = await JudgeService.updateJudge(initialData.id, judgeData);
        const saved = res?.data ?? { ...initialData, ...judgeData };
        setJudges((prev) => {
          const next = prev.map((j) => (j.id === saved.id ? saved : j));
          updateLlms(LLMTYPES.JUDGE, next);
          return next;
        });
      } else {
        const res = await JudgeService.createJudge(judgeData);
        const saved = res?.data ?? judgeData;
        setJudges((prev) => {
          const next = [...prev, saved];
          updateLlms(LLMTYPES.JUDGE, next);
          return next;
        });
      }
      onBack();
    } catch (err) {
      const detail = err?.data?.detail ?? err?.message ?? "Server error";
      setError(`Failed to save judge: ${detail}`);
    }
  };

  const lockedByRuns = isEdit && !!initialData?.has_runs;

  return (
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Judge Models"
        title={
          isEdit ? `Edit "${initialData.name}"` : "Create a judge model"
        }
        description="Pick a model and prompt, then choose how responses will be evaluated."
      />
      {lockedByRuns && (
        <Typography sx={{ fontSize: "0.85rem", color: "warning.dark", bgcolor: "warning.50", border: "1px solid", borderColor: "warning.200", borderRadius: 2, px: 2, py: 1.25 }}>
          This judge has experiment runs. Only the name can be changed to preserve result integrity.
        </Typography>
      )}

      {/* Row 1: Mode + Provider | Credentials */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" },
          gap: 3,
        }}
      >
        <Stack spacing={3}>
          <Paper sx={sectionCardSx}>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
              Evaluation Type
            </Typography>
            <Typography sx={{ fontSize: "0.82rem", color: "text.secondary", mb: 1.5 }}>
              {mode === "boolean"
                ? "Judge returns a pass/fail verdict — use with LLM Binary evaluation."
                : "Judge returns a numeric score — use with LLM Scoring evaluation."}
            </Typography>
            <FormControl fullWidth>
              <InputLabel id="judge-mode-label">Evaluation Type</InputLabel>
              <Select
                labelId="judge-mode-label"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                label="Evaluation Type"
                disabled={lockedByRuns}
              >
                {JUDGE_MODES.map((item) => (
                  <MenuItem key={item} value={item}>
                    {JUDGE_MODE_LABELS[item] ?? item}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Paper>

          <Paper sx={sectionCardSx}>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
              Provider
            </Typography>
            <VendorModelSelector
              vendor={vendor}
              model={model}
              onVendorChange={handleVendorChange}
              onModelChange={setModel}
              disabled={isEdit}
            />
          </Paper>
        </Stack>

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
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              helperText="The name used to identify this saved judge."
            />
            {!isEdit && (
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
            <TextField
              label="Base URL"
              value={isEdit ? (initialData?.base_url ?? "") : baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              fullWidth
              disabled={isEdit}
              placeholder="https://api.example.com/v1"
              helperText={isEdit ? "Cannot be changed after creation." : "Required if no API key is provided."}
            />
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, color: "text.secondary", fontSize: "0.82rem" }}>System Prompt</Typography>
                <PromptPicker
                  promptType="judge"
                  disabled={lockedByRuns}
                  onLoad={(content) => setSystemPrompt(content)}
                  onAppend={(content) => setSystemPrompt((prev) => prev ? `${prev}\n\n${content}` : content)}
                  onLoadFull={(p) => {
                    if (p.judge_mode) setMode(p.judge_mode);
                    if (p.judge_mode === "score") {
                      if (p.score_min != null) setScoreMin(String(p.score_min));
                      if (p.score_max != null) setScoreMax(String(p.score_max));
                    }
                    if (p.judge_mode === "boolean") {
                      if (p.correct_tokens?.length) setCorrectTokens(p.correct_tokens.join(", "));
                      if (p.incorrect_tokens?.length) setIncorrectTokens(p.incorrect_tokens.join(", "));
                    }
                  }}
                />
              </Stack>
              <TextField
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                fullWidth
                multiline
                minRows={3}
                disabled={lockedByRuns}
                placeholder="Enter system prompt or browse library..."
              />
            </Box>
          </Stack>
        </Paper>
      </Box>

      {/* Row 2: Mode-specific config */}
      <Paper sx={sectionCardSx}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
          {mode === "score" ? "Score Range" : "Verdict Labels"}
        </Typography>
        {mode === "score" ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 2,
            }}
          >
            <TextField
              label="Score Min"
              type="number"
              value={scoreMin}
              onChange={(e) => setScoreMin(e.target.value)}
              fullWidth
              inputProps={{ step: 0.1 }}
              disabled={lockedByRuns}
            />
            <TextField
              label="Score Max"
              type="number"
              value={scoreMax}
              onChange={(e) => setScoreMax(e.target.value)}
              fullWidth
              inputProps={{ step: 0.1 }}
              disabled={lockedByRuns}
            />
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 2,
            }}
          >
            <TextField
              label="Positive Labels"
              value={correctTokens}
              onChange={(e) => setCorrectTokens(e.target.value)}
              fullWidth
              helperText="Comma-separated, e.g. correct, yes, true"
              disabled={lockedByRuns}
            />
            <TextField
              label="Negative Labels"
              value={incorrectTokens}
              onChange={(e) => setIncorrectTokens(e.target.value)}
              fullWidth
              disabled={lockedByRuns}
              helperText="Comma-separated, e.g. incorrect, no, false"
            />
          </Box>
        )}
      </Paper>

      {/* Row 3: Inference parameters */}
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
        <Button variant="contained" sx={actionButtonSx} onClick={handleSubmit}>
          {isEdit ? "Save Changes" : "Save Judge Model"}
        </Button>
      </Box>
    </Stack>
  );
};

const JUDGE_PAGE_SIZE = 6;

const JudgeList = ({ judges, onEdit, onDelete, onRename }) => {
  const [openId, setOpenId] = React.useState(null);
  const [renamingId, setRenamingId] = React.useState(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [renaming, setRenaming] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [searchQuery, setSearchQuery] = React.useState("");
  React.useEffect(() => { setPage(0); }, [searchQuery]);

  const sortedJudges = React.useMemo(
    () => [...judges].sort((a, b) => (a.has_runs ? 1 : 0) - (b.has_runs ? 1 : 0)),
    [judges]
  );

  const filteredJudges = React.useMemo(() => {
    if (!searchQuery.trim()) return sortedJudges;
    const q = searchQuery.toLowerCase();
    return sortedJudges.filter(
      (j) => j.name?.toLowerCase().includes(q) || j.provider?.toLowerCase().includes(q)
    );
  }, [sortedJudges, searchQuery]);

  const paginated = filteredJudges.length > JUDGE_PAGE_SIZE;
  const pageCount = Math.ceil(filteredJudges.length / JUDGE_PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleJudges = paginated
    ? filteredJudges.slice(safePage * JUDGE_PAGE_SIZE, (safePage + 1) * JUDGE_PAGE_SIZE)
    : filteredJudges;

  const startRename = (e, item) => { e.stopPropagation(); setRenamingId(item.id); setRenameValue(item.name); };
  const cancelRename = (e) => { e?.stopPropagation(); setRenamingId(null); };
  const submitRename = async (e, item) => {
    e.stopPropagation();
    if (!renameValue.trim() || renameValue === item.name) { cancelRename(); return; }
    setRenaming(true);
    try {
      const res = await JudgeService.updateJudge(item.id, { name: renameValue.trim() });
      onRename(item.id, renameValue.trim(), res?.data);
      setRenamingId(null);
    } catch {
    } finally {
      setRenaming(false);
    }
  };

  if (judges.length === 0) {
    return (
      <Typography sx={{ color: "text.secondary" }}>
        No judge models saved yet.
      </Typography>
    );
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
      {visibleJudges.length === 0 && searchQuery.trim() && (
        <ListItem sx={{ px: 0 }}>
          <ListItemText primary="No judge models match your search." />
        </ListItem>
      )}
      {visibleJudges.map((item) => {
        const id = item.id ?? item.name;
        const isOpen = openId === id;
        const isRenaming = renamingId === id;
        const params = item.params ?? {};
        const filledParams = Object.entries(params).filter(
          ([, v]) => v !== null && v !== undefined && v !== "",
        );
        const hasParams = filledParams.length > 0;
        const isScore = item.mode === "score";

        return (
          <Box key={id} sx={{ borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
            <ListItem
              sx={{ px: 0, py: 1.25, cursor: "pointer" }}
              onClick={() => !isRenaming && setOpenId(isOpen ? null : id)}
            >
              {isRenaming ? (
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", flex: 1 }} onClick={(e) => e.stopPropagation()}>
                  <TextField size="small" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitRename(e, item); if (e.key === "Escape") cancelRename(e); }} autoFocus sx={{ flex: 1 }} />
                  <Button size="small" variant="contained" disabled={renaming} onClick={(e) => submitRename(e, item)}>Save</Button>
                  <Button size="small" variant="outlined" onClick={cancelRename}>Cancel</Button>
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flex: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: item.has_runs ? "success.main" : "action.disabled" }} title={item.has_runs ? "Used in experiments" : "Not used yet"} />
                  <ListItemText
                    primary={<Typography sx={{ fontWeight: 600 }}>{item.name ?? "Untitled Judge Model"}</Typography>}
                    secondary={[item.provider, item.model_name, item.mode].filter(Boolean).join(" · ")}
                  />
                </Box>
              )}
              <Typography
                sx={{ fontSize: "0.8rem", color: "text.secondary", ml: 1 }}
              >
                {isOpen ? "▲" : "▼"}
              </Typography>
            </ListItem>

            <Collapse in={isOpen} unmountOnExit>
              <Stack spacing={1.5} sx={{ pb: 2, px: 0.5 }}>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {item.provider && (
                    <Chip
                      label={item.provider}
                      size="small"
                      variant="outlined"
                    />
                  )}
                  {item.model_name && (
                    <Chip
                      label={item.model_name}
                      size="small"
                      variant="outlined"
                    />
                  )}
                  {item.mode && (
                    <Chip
                      label={`Mode: ${JUDGE_MODE_LABELS[item.mode] ?? item.mode}`}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  )}
                  {item.base_url && (
                    <Chip
                      label={item.base_url}
                      size="small"
                      variant="outlined"
                    />
                  )}
                </Stack>

                {isScore ? (
                  <Stack direction="row" spacing={1}>
                    {item.score_min != null && (
                      <Chip
                        label={`Min: ${item.score_min}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                    {item.score_max != null && (
                      <Chip
                        label={`Max: ${item.score_max}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Stack>
                ) : (
                  <Stack spacing={0.75}>
                    {item.correct_tokens?.length > 0 && (
                      <Typography
                        sx={{ fontSize: "0.82rem", color: "text.secondary" }}
                      >
                        Correct tokens:{" "}
                        <strong>{item.correct_tokens.join(", ")}</strong>
                      </Typography>
                    )}
                    {item.incorrect_tokens?.length > 0 && (
                      <Typography
                        sx={{ fontSize: "0.82rem", color: "text.secondary" }}
                      >
                        Incorrect tokens:{" "}
                        <strong>{item.incorrect_tokens.join(", ")}</strong>
                      </Typography>
                    )}
                  </Stack>
                )}

                {item.system_prompt && (
                  <Box>
                    <Typography
                      sx={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "text.secondary",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        mb: 0.5,
                      }}
                    >
                      System Prompt
                    </Typography>
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        background: "rgba(15,23,42,0.04)",
                        border: "1px solid rgba(15,23,42,0.08)",
                        fontFamily: "monospace",
                        fontSize: "0.8rem",
                        whiteSpace: "pre-wrap",
                        maxHeight: 120,
                        overflowY: "auto",
                      }}
                    >
                      {item.system_prompt}
                    </Box>
                  </Box>
                )}

                {hasParams && (
                  <Box>
                    <Typography
                      sx={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "text.secondary",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        mb: 0.75,
                      }}
                    >
                      Parameters
                    </Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                      {filledParams.map(([k, v]) => (
                        <Chip
                          key={k}
                          label={`${k}: ${v}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                <Stack direction="row" spacing={1}>
                  {item.has_runs ? (
                    <Button size="small" variant="outlined" sx={{ textTransform: "none", borderRadius: 999, width: "fit-content" }} onClick={(e) => startRename(e, item)}>
                      Rename
                    </Button>
                  ) : (
                    <Button size="small" variant="outlined" sx={{ textTransform: "none", borderRadius: 999, width: "fit-content" }} onClick={(e) => { e.stopPropagation(); onEdit(item); }}>
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

const Judges = () => {
  const [view, setView] = React.useState("list");
  const [editingJudge, setEditingJudge] = React.useState(null);
  const { llms, updateLlms } = React.useContext(LlmContext);
  const [judges, setJudges] = React.useState(llms.judges ?? []);
  const [deleteError, setDeleteError] = React.useState("");

  React.useEffect(() => {
    JudgeService.getJudges()
      .then((res) => {
        const apiJudges = res?.data ?? [];
        if (apiJudges.length > 0) {
          setJudges(apiJudges);
          updateLlms(LLMTYPES.JUDGE, apiJudges);
        }
      })
      .catch(() => {});
  }, []);

  const handleEdit = (judge) => { setEditingJudge(judge); setView("edit"); };
  const handleBack = () => { setEditingJudge(null); setView("list"); };
  const handleRename = (id, newName, updated) => {
    const next = judges.map((j) => (j.id ?? j.name) === id ? { ...j, name: newName, ...(updated ?? {}) } : j);
    setJudges(next);
    updateLlms(LLMTYPES.JUDGE, next);
  };
  const handleDelete = async (judge) => {
    const id = judge.id ?? judge.name;
    try {
      await JudgeService.deleteJudge(id);
      const updated = judges.filter((j) => (j.id ?? j.name) !== id);
      setJudges(updated);
      updateLlms(LLMTYPES.JUDGE, updated);
    } catch (err) {
      const detail = err?.data?.detail ?? err?.message ?? "Server error";
      setDeleteError(`Failed to delete judge model: ${detail}`);
    }
  };

  return (
    <Box sx={pageShellSx}>
      <Paper sx={frameSx}>
        {view === "add" && (
          <AddJudge
            setJudges={setJudges}
            onBack={handleBack}
            updateLlms={updateLlms}
          />
        )}
        {view === "edit" && (
          <AddJudge
            setJudges={setJudges}
            onBack={handleBack}
            updateLlms={updateLlms}
            initialData={editingJudge}
          />
        )}
        {view === "list" && (
          <Stack spacing={3}>
          <ErrorSnackbar message={deleteError} onClose={() => setDeleteError("")} />
            <StageHeader
              eyebrow="Judge Models"
              title="Saved judge models"
              description="Configure evaluators to assess model responses in your experiments."
            />
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", xl: "1.15fr 0.85fr" },
                gap: 3,
                alignItems: "start",
              }}
            >
              <Paper sx={sectionCardSx}>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>
                  Saved Judge Models
                </Typography>
                <JudgeList judges={judges ?? []} onEdit={handleEdit} onDelete={handleDelete} onRename={handleRename} />
              </Paper>
              <Paper
                sx={{
                  ...sectionCardSx,
                  background:
                    "linear-gradient(135deg, rgba(25,118,210,0.12) 0%, rgba(144,202,249,0.1) 100%)",
                }}
              >
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>
                  Add a judge model
                </Typography>
                <Typography sx={{ color: "text.secondary", mb: 3 }}>
                  Pick a model and prompt, then choose how responses will be evaluated.
                </Typography>
                <Box sx={{ display: "flex", justifyContent: "center" }}>
                  <Button
                    variant="contained"
                    sx={actionButtonSx}
                    onClick={() => setView("add")}
                  >
                    Add Judge Model
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

export default Judges;
