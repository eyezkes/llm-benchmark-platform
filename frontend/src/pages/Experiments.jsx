import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
  Tooltip,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import { DataGrid } from "@mui/x-data-grid";
import React from "react";
import { Link, useNavigate, useLocation } from "react-router";
import { LlmContext } from "../context/LlmContext";
import ExperimentService from "../api/services/experiment";
import DatasetService from "../api/services/dataset";
import ErrorSnackbar from "../components/ErrorSnackbar";
import PromptPicker from "../components/PromptPicker";

const pageShellSx = {
  minHeight: "100vh",
  px: { xs: 2, md: 4 },
  py: { xs: 3, md: 5 },
  background:
    "radial-gradient(circle at top left, rgba(25,118,210,0.14), transparent 32%), radial-gradient(circle at top right, rgba(100,181,246,0.18), transparent 28%), linear-gradient(180deg, #f7fbff 0%, #eef4fb 100%)",
};

const wizardFrameSx = {
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


const STATUS_COLOR = {
  pending: "default",
  running: "info",
  completed: "success",
  failed: "error",
};

const wizardStageLabels = ["Model Setup", "Dataset Setup", "Evaluation"];

const judgeTypeOptions = {
  open_with_true:  ["equals", "contains", "json_equals", "llm_bool", "llm_score", "similarity"],
  mc_with_true:    ["equals", "llm_bool", "llm_score"],
  no_true_answer:  ["llm_bool", "llm_score"],
};

const JUDGE_TYPE_LABELS = {
  llm_bool: "LLM Binary",
  llm_score: "LLM Scoring",
  equals: "Exact Match",
  contains: "Contains",
  json_equals: "JSON Match",
  similarity: "Similarity Metrics (BLEU, ROUGE-L, CER, Semantic, Perplexity)",
};

const JUDGE_TYPE_DESCRIPTIONS = {
  equals: "Output must match the reference answer exactly.",
  contains: "Reference answer must appear somewhere in the output.",
  json_equals: "Compares outputs as JSON — ignores formatting, checks values.",
  llm_bool: "An LLM judge decides whether the response is correct or incorrect.",
  llm_score: "An LLM judge rates the response on a numeric scale.",
  similarity: "Measures how similar the output is to the reference using multiple metrics.",
};

const DATASET_TYPE_LABELS = {
  mc_with_true: "Multiple Choice",
  open_with_true: "Open Answer with Reference",
  no_true_answer: "Open Answer",
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

const StageChips = ({ stage, maxStage, onStageClick }) => (
  <Stack
    direction={{ xs: "column", md: "row" }}
    spacing={1.25}
    sx={{ mb: 4 }}
  >
    {wizardStageLabels.map((label, index) => {
      const stageNum = index + 1;
      const isActive = stageNum === stage;
      const isReachable = stageNum <= maxStage && !isActive;
      return (
        <Chip
          key={label}
          label={`${stageNum}. ${label}`}
          color={isActive ? "primary" : "default"}
          variant={stageNum <= maxStage ? "filled" : "outlined"}
          onClick={isReachable ? () => onStageClick(stageNum) : undefined}
          sx={{
            justifyContent: "flex-start",
            px: 0.75,
            borderRadius: 999,
            fontWeight: isActive ? 700 : 500,
            bgcolor: isActive
              ? "primary.main"
              : isReachable
              ? "rgba(25,118,210,0.15)"
              : "rgba(255,255,255,0.7)",
            cursor: isReachable ? "pointer" : "default",
            "&:hover": isReachable ? { bgcolor: "rgba(25,118,210,0.22)" } : {},
          }}
        />
      );
    })}
  </Stack>
);

const ARCHIVE_KEY = "wabs_archived_experiments";
const EXP_PAGE_SIZE = 6;

const readArchived = () => {
  try { return new Set(JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? "[]")); }
  catch { return new Set(); }
};

const DefaultPage = ({ onClick, onEdit, listVersion }) => {
  const [experiments, setExperiments] = React.useState([]);
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [deleteError, setDeleteError] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [archivedIds, setArchivedIds] = React.useState(readArchived);
  const [showArchived, setShowArchived] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [searchQuery, setSearchQuery] = React.useState("");
  React.useEffect(() => { setPage(0); }, [searchQuery, showArchived]);

  React.useEffect(() => {
    ExperimentService.getExperiments()
      .then((res) => setExperiments(res?.data ?? []))
      .catch(() => {});
  }, [listVersion]);

  const toggleArchive = (id) => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await ExperimentService.deleteExperiment(deleteTarget.id);
      setExperiments((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      const detail = err?.data?.detail ?? err?.message ?? "Server error";
      setDeleteError(`Failed to delete experiment: ${detail}`);
    } finally {
      setDeleting(false);
    }
  };

  const visibleExps = experiments
    .filter((e) => showArchived ? archivedIds.has(e.id) : !archivedIds.has(e.id))
    .filter((e) => !searchQuery.trim() || e.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  const paginated = visibleExps.length > EXP_PAGE_SIZE;
  const pageCount = Math.ceil(visibleExps.length / EXP_PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const pageExps = paginated
    ? visibleExps.slice(safePage * EXP_PAGE_SIZE, (safePage + 1) * EXP_PAGE_SIZE)
    : visibleExps;

  const archivedCount = experiments.filter((e) => archivedIds.has(e.id)).length;

  return (
    <>
    <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}>
      <DialogTitle>Delete experiment?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          <strong>{deleteTarget?.name}</strong> and all its runs will be permanently deleted. This cannot be undone.
        </DialogContentText>
        <ErrorSnackbar message={deleteError} onClose={() => setDeleteError("")} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => { setDeleteTarget(null); setDeleteError(""); }} disabled={deleting}>Cancel</Button>
        <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}
          startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : null}>
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Experiments"
        title="Create or reopen an experiment"
        description="Use an existing experiment as a reference point or start a new benchmark run."
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1.1fr 0.9fr" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Paper sx={sectionCardSx}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Current experiments
            </Typography>
            <Button
              size="small"
              variant="outlined"
              sx={{ textTransform: "none", borderRadius: 999, fontSize: "0.78rem", ...(showArchived && { borderColor: "#455a64", color: "#455a64" }) }}
              onClick={() => { setShowArchived((v) => !v); setPage(0); }}
            >
              {showArchived ? "Hide Archive" : `Show Archive${archivedCount > 0 ? ` (${archivedCount})` : ""}`}
            </Button>
          </Box>
          <TextField
            size="small"
            placeholder="Search experiments…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            fullWidth
            sx={{ mb: 1.5 }}
          />
          <List sx={{ p: 0 }}>
            {visibleExps.length === 0 ? (
              <ListItem sx={{ px: 0 }}>
                <ListItemText
                  primary={searchQuery.trim() ? "No experiments match your search." : showArchived ? "No archived experiments" : "No experiments yet"}
                  secondary={!searchQuery.trim() && !showArchived ? "Start one below." : undefined}
                />
              </ListItem>
            ) : (
              pageExps.map((exp) => (
                <ListItem
                  key={exp.id}
                  sx={{ px: 0, py: 1.25, borderBottom: "1px solid rgba(15,23,42,0.06)", display: "flex", alignItems: "center", gap: 1.5 }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                      <Link to={`/experiments/${exp.id}`} style={{ textDecoration: "none", minWidth: 0, overflow: "hidden" }}>
                        <Typography sx={{ fontWeight: 600, color: "#1565c0", fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {exp.name ?? exp.id}
                        </Typography>
                      </Link>
                    </Box>
                    {exp.description && (
                      <Typography sx={{ fontSize: "0.8rem", color: "text.secondary", mt: 0.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {exp.description}
                      </Typography>
                    )}
                    <Chip
                      label={exp.status ?? "unknown"}
                      color={STATUS_COLOR[exp.status] ?? "default"}
                      size="small"
                      sx={{ mt: 0.5, fontWeight: 700, borderRadius: 999, fontSize: "0.72rem" }}
                    />
                  </Box>
                  {!showArchived && exp.status !== "running" && (
                    <Button
                      size="small"
                      variant="outlined"
                      sx={{ textTransform: "none", borderRadius: 999, flexShrink: 0 }}
                      onClick={() => onEdit(exp)}
                    >
                      Edit
                    </Button>
                  )}
                  {exp.status !== "running" && (
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      sx={{ textTransform: "none", borderRadius: 999, flexShrink: 0 }}
                      onClick={() => setDeleteTarget(exp)}
                    >
                      Delete
                    </Button>
                  )}
                  <Tooltip title={archivedIds.has(exp.id) ? "Unarchive" : "Archive"} placement="top" arrow>
                    <IconButton
                      size="small"
                      onClick={() => toggleArchive(exp.id)}
                      sx={{ flexShrink: 0, color: "#455a64" }}
                    >
                      {archivedIds.has(exp.id) ? <UnarchiveIcon fontSize="small" /> : <Inventory2Icon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </ListItem>
              ))
            )}
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
        </Paper>
        <Paper
          sx={{
            ...sectionCardSx,
            background:
              "linear-gradient(135deg, rgba(25,118,210,0.12) 0%, rgba(144,202,249,0.1) 100%)",
          }}
        >
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>
            Add an experiment
          </Typography>
          <Typography sx={{ color: "text.secondary", mb: 3 }}>
            Pick models, a dataset, and an evaluator — then start the benchmark.
          </Typography>
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Button variant="contained" sx={actionButtonSx} onClick={onClick}>
              Add Experiment
            </Button>
          </Box>
        </Paper>
      </Box>
    </Stack>
    </>
  );
};

const ConfigureModel = ({ selectedModels, setData, onBack, onClick, experimentName, experimentDescription, systemPromptOverride }) => {
  const { models = [] } = React.useContext(LlmContext).llms ?? {};
  const [currentModelName, setCurrentModelName] = React.useState("");

  const handleNameChange = (e) => {
    setData((prev) => ({ ...prev, name: e.target.value }));
  };

  const handleDescriptionChange = (e) => {
    setData((prev) => ({ ...prev, description: e.target.value }));
  };

  const handleSystemPromptChange = (e) => {
    setData((prev) => ({ ...prev, system_prompt_override: e.target.value }));
  };

  const handleAdd = () => {
    const item = models.find((m) => m.name === currentModelName);
    if (!item) return;
    if (selectedModels.some((m) => m.id === item.id)) return;
    setData((prev) => ({
      ...prev,
      models: [...(prev.models ?? []), { name: item.name, id: item.id }],
    }));
    setCurrentModelName("");
  };

  const handleRemove = (id) => {
    setData((prev) => ({
      ...prev,
      models: (prev.models ?? []).filter((m) => m.id !== id),
    }));
  };

  const canProceed = experimentName?.trim() !== "" && selectedModels.length > 0;

  return (
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Step 1"
        title="Name your experiment and pick models"
        description="Add one or more models to benchmark against each other."
      />
      <TextField
        fullWidth
        required
        label="Experiment Name"
        value={experimentName ?? ""}
        onChange={handleNameChange}
      />
      <TextField
        fullWidth
        label="Description"
        value={experimentDescription ?? ""}
        onChange={handleDescriptionChange}
        multiline
        minRows={2}
        helperText="Optional — what are you testing?"
      />
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
            Shared System Prompt
          </Typography>
          <PromptPicker
            promptType="model"
            onLoad={(content) => setData((prev) => ({ ...prev, system_prompt_override: content }))}
            onAppend={(content) =>
              setData((prev) => ({
                ...prev,
                system_prompt_override: prev.system_prompt_override
                  ? prev.system_prompt_override + "\n" + content
                  : content,
              }))
            }
          />
        </Box>
        <TextField
          fullWidth
          value={systemPromptOverride ?? ""}
          onChange={handleSystemPromptChange}
          multiline
          minRows={3}
          placeholder="Optional — overrides each model's own system prompt for this experiment. All candidate models will use this prompt."
          size="small"
        />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" }, gap: 3 }}>
        <Paper sx={sectionCardSx}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>
            Selected models
          </Typography>
          {selectedModels.length === 0 ? (
            <Typography sx={{ color: "text.secondary" }}>
              No models added yet. Add at least one to continue.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {selectedModels.map((m) => {
                const full = models.find((x) => x.id === m.id);
                return (
                  <Box
                    key={m.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      px: 2,
                      py: 1.25,
                      borderRadius: 2,
                      border: "1px solid rgba(25,118,210,0.15)",
                      background: "rgba(25,118,210,0.04)",
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: "0.9rem" }}>{m.name}</Typography>
                      {full && (
                        <Tooltip placement="top" arrow title={
                          <Box sx={{ p: 0.5 }}>
                            <Typography sx={{ fontSize: "0.75rem", fontWeight: 700 }}>{full.model_name}</Typography>
                            <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)" }}>Provider: {full.provider}</Typography>
                            {full.system_prompt && <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)", maxWidth: 260, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>Prompt: {full.system_prompt.length > 120 ? full.system_prompt.slice(0, 120) + "…" : full.system_prompt}</Typography>}
                          </Box>
                        }>
                          <Box component="span" sx={{ color: "text.disabled", cursor: "help", fontSize: "0.8rem", userSelect: "none", lineHeight: 1 }}>ℹ</Box>
                        </Tooltip>
                      )}
                    </Box>
                    <Button
                      size="small"
                      color="error"
                      sx={{ textTransform: "none", borderRadius: 999, minWidth: 0, px: 1.5 }}
                      onClick={() => handleRemove(m.id)}
                    >
                      Remove
                    </Button>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Paper>

        <Paper
          sx={{
            ...sectionCardSx,
            background: "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(243,249,255,1) 100%)",
          }}
        >
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
            Add a model
          </Typography>
          <Stack spacing={2.5}>
            <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>
              Choose from your saved models. To add a new one, go to the{" "}
              <Link to="/models" style={{ color: "#1565c0" }}>Models page</Link>.
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 1.5, alignItems: "center" }}>
              <Autocomplete
                options={[...models].sort((a, b) => (a.has_runs ? 1 : 0) - (b.has_runs ? 1 : 0))}
                getOptionLabel={(option) => option.name ?? ""}
                value={models.find((m) => m.name === currentModelName) ?? null}
                onChange={(_, newValue) => setCurrentModelName(newValue?.name ?? "")}
                isOptionEqualToValue={(option, value) => option.name === value.name}
                renderOption={(props, option) => (
                  <li {...props}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, width: "100%" }}>
                      <span style={{ flex: 1 }}>{option.name}</span>
                      <Tooltip placement="left" arrow slotProps={{ tooltip: { sx: { fontSize: "0.78rem", p: 1.25 } } }} title={
                        <Box>
                          <Typography sx={{ fontSize: "0.75rem", fontWeight: 700 }}>{option.model_name}</Typography>
                          <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)" }}>Provider: {option.provider}</Typography>
                          {option.system_prompt && <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)", maxWidth: 260, whiteSpace: "pre-wrap", wordBreak: "break-word", mt: 0.5 }}>Prompt: {option.system_prompt.length > 120 ? option.system_prompt.slice(0, 120) + "…" : option.system_prompt}</Typography>}
                        </Box>
                      }>
                        <Box component="span" onClick={(e) => e.stopPropagation()} sx={{ color: "text.disabled", cursor: "help", fontSize: "0.8rem", userSelect: "none", lineHeight: 1 }}>ℹ</Box>
                      </Tooltip>
                    </Box>
                  </li>
                )}
                renderInput={(params) => <TextField {...params} label="Model" />}
                fullWidth
              />
              <Button
                variant="outlined"
                sx={actionButtonSx}
                onClick={handleAdd}
                disabled={!currentModelName}
              >
                Add Model
              </Button>
            </Box>
          </Stack>
        </Paper>
      </Box>
      <Box sx={actionRowSx}>
        <Button variant="outlined" sx={actionButtonSx} onClick={onBack}>
          Back
        </Button>
        <Button
          variant="contained"
          sx={actionButtonSx}
          disabled={!canProceed}
          onClick={onClick}
        >
          Next
        </Button>
      </Box>
    </Stack>
  );
};

const ConfigureDataset = ({ onBack, onClick }) => {
  const [rows, setRows] = React.useState([]);
  const [datasetSearch, setDatasetSearch] = React.useState("");

  React.useEffect(() => {
    DatasetService.getDatasets()
      .then((res) => setRows(res?.data ?? []))
      .catch(() => {});
  }, []);

  const filteredDatasetRows = datasetSearch.trim()
    ? rows.filter((r) => r.name?.toLowerCase().includes(datasetSearch.toLowerCase()))
    : rows;

  const cols = [
    { field: "name", headerName: "Dataset Name", flex: 1, minWidth: 160 },
    { field: "dataset_type", headerName: "Type", flex: 1, minWidth: 180 },
    { field: "number_of_questions", headerName: "Questions", width: 100 },
    { field: "description", headerName: "Description", flex: 1, minWidth: 200 },
  ];

  const handleRowSelectionChange = (selectionModel) => {
    const ids = Array.isArray(selectionModel)
      ? selectionModel
      : Array.from(selectionModel?.ids ?? []);
    if (ids.length === 0) {
      setSelectedRowId([]);
      return;
    }
    const selectedDataset = rows.find((row) => row.id === ids[0]);
    onClick({ ...selectedDataset, source: "preset", type: selectedDataset?.dataset_type ?? "" });
  };

  return (
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Step 2"
        title="Pick a dataset"
        description="Select a dataset to use in this experiment. To upload a new one, go to the Datasets page."
      />
      <Paper sx={sectionCardSx}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>
          Dataset
        </Typography>
        <Typography sx={{ color: "text.secondary", mb: 2 }}>
          Choose from your uploaded datasets. To add a new one, visit the{" "}
          <Link to="/datasets" style={{ color: "#1565c0" }}>Datasets page</Link>.
        </Typography>
        <TextField
          size="small"
          placeholder="Search datasets…"
          value={datasetSearch}
          onChange={(e) => setDatasetSearch(e.target.value)}
          fullWidth
          sx={{ mb: 1.5 }}
        />
        <Box sx={{ height: 340 }}>
          <DataGrid
            disableMultipleRowSelection
            rows={filteredDatasetRows}
            columns={cols}
            checkboxSelection
            onRowSelectionModelChange={handleRowSelectionChange}
            sx={{
              borderRadius: 3,
              borderColor: "rgba(25,118,210,0.12)",
              "& .MuiDataGrid-columnHeaders": {
                backgroundColor: "rgba(25,118,210,0.06)",
              },
            }}
          />
        </Box>
      </Paper>
      <Box sx={actionRowSx}>
        <Button variant="outlined" sx={actionButtonSx} onClick={onBack}>
          Back
        </Button>
      </Box>
    </Stack>
  );
};

const JUDGE_MODE_FOR_TYPE = { llm_bool: "boolean", llm_score: "score" };

const ConfigureOptions = ({ datasetType, datasetQuestionCount, onBack, onFinish, submitting }) => {
  const { llms } = React.useContext(LlmContext);
  const allJudgeModels = llms?.judges ?? [];
  const availableJudgeTypes = judgeTypeOptions[datasetType] ?? [];

  const [enabledTypes, setEnabledTypes] = React.useState(new Set());
  // judgeModels: { [type]: [id1, id2, ...] }
  const [judgeModels, setJudgeModels] = React.useState({});
  // pendingJudge: { [type]: id currently selected in dropdown }
  const [pendingJudge, setPendingJudge] = React.useState({});
  const [sampleSize, setSampleSize] = React.useState(datasetQuestionCount ?? 50);
  const [seed, setSeed] = React.useState(42);

  const needsModel = (type) => type === "llm_bool" || type === "llm_score";

  const toggleType = (type) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
        setJudgeModels((jm) => { const n = { ...jm }; delete n[type]; return n; });
        setPendingJudge((pj) => { const n = { ...pj }; delete n[type]; return n; });
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const addJudgeModel = (type) => {
    const id = pendingJudge[type];
    if (!id) return;
    setJudgeModels((prev) => ({ ...prev, [type]: [...(prev[type] ?? []), id] }));
    setPendingJudge((prev) => ({ ...prev, [type]: "" }));
  };

  const removeJudgeModel = (type, id) => {
    setJudgeModels((prev) => ({ ...prev, [type]: (prev[type] ?? []).filter((i) => i !== id) }));
  };

  const isValid =
    enabledTypes.size > 0 &&
    [...enabledTypes].every((type) => !needsModel(type) || (judgeModels[type]?.length ?? 0) > 0);

  const handleClick = (e) => {
    e.preventDefault();
    const judgeConfigs = [...enabledTypes].flatMap((type) => {
      if (!needsModel(type)) return [{ judgeType: type, judgeModelId: null }];
      return (judgeModels[type] ?? []).map((id) => ({ judgeType: type, judgeModelId: id }));
    });
    onFinish({ judgeConfigs, sampleSize, seed });
  };

  return (
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Step 3"
        title="Choose how results are judged"
        description="Choose how your model responses will be evaluated."
      />

      <Paper sx={sectionCardSx}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
          Evaluation Method
        </Typography>
        <Typography sx={{ color: "text.secondary", fontSize: "0.85rem", mb: 2 }}>
          Dataset type: <strong>{DATASET_TYPE_LABELS[datasetType] ?? datasetType}</strong>
        </Typography>
        <Stack spacing={1}>
          {availableJudgeTypes.map((type) => {
            const enabled = enabledTypes.has(type);
            const llm = needsModel(type);
            const compatibleModels = llm
              ? allJudgeModels.filter((j) => j.mode === JUDGE_MODE_FOR_TYPE[type])
              : [];
            const selectedIds = judgeModels[type] ?? [];
            const missingModel = enabled && llm && selectedIds.length === 0;

            return (
              <Box
                key={type}
                sx={{
                  px: 2,
                  py: 1.5,
                  borderRadius: 2,
                  border: `1px solid ${
                    missingModel
                      ? "rgba(211,47,47,0.35)"
                      : enabled
                      ? "rgba(25,118,210,0.4)"
                      : "rgba(15,23,42,0.1)"
                  }`,
                  background: enabled ? "rgba(25,118,210,0.04)" : "transparent",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <Box
                  onClick={() => toggleType(type)}
                  sx={{ display: "flex", alignItems: "center", gap: 1.5, cursor: "pointer", "&:hover": { opacity: 0.8 } }}
                >
                  <Chip
                    label={enabled ? "✓" : "+"}
                    color={enabled ? "primary" : "default"}
                    size="small"
                    variant={enabled ? "filled" : "outlined"}
                    sx={{ borderRadius: 999, width: 32, minWidth: 32, pointerEvents: "none" }}
                  />
                  <Box>
                    <Typography sx={{ fontWeight: enabled ? 700 : 400, fontSize: "0.9rem" }}>
                      {JUDGE_TYPE_LABELS[type] ?? type}
                    </Typography>
                    {JUDGE_TYPE_DESCRIPTIONS[type] && (
                      <Typography sx={{ fontSize: "0.75rem", color: "text.secondary", mt: 0.25 }}>
                        {JUDGE_TYPE_DESCRIPTIONS[type]}
                      </Typography>
                    )}
                  </Box>
                </Box>

                {llm && enabled && (
                  <Box sx={{ mt: 1.5, ml: 5.5 }}>
                    {selectedIds.length > 0 && (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                        {selectedIds.map((id) => {
                          const judge = allJudgeModels.find((j) => (j.id ?? j.name) === id);
                          return (
                            <Tooltip key={id} placement="top" arrow slotProps={{ tooltip: { sx: { fontSize: "0.78rem", p: 1.25 } } }} title={judge ? (
                              <Box>
                                <Typography sx={{ fontSize: "0.75rem", fontWeight: 700 }}>{judge.model_name}</Typography>
                                <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)" }}>Provider: {judge.provider}</Typography>
                                {judge.system_prompt && <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)", maxWidth: 260, whiteSpace: "pre-wrap", wordBreak: "break-word", mt: 0.5 }}>Prompt: {judge.system_prompt.length > 120 ? judge.system_prompt.slice(0, 120) + "…" : judge.system_prompt}</Typography>}
                              </Box>
                            ) : ""}>
                              <Chip
                                label={judge?.name ?? id}
                                size="small"
                                color="primary"
                                variant="outlined"
                                onDelete={() => removeJudgeModel(type, id)}
                                sx={{ borderRadius: 999 }}
                              />
                            </Tooltip>
                          );
                        })}
                      </Box>
                    )}
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      <FormControl size="small" sx={{ flex: 1 }} error={missingModel}>
                        <InputLabel id={`jm-${type}`}>
                          {selectedIds.length === 0 ? "Select judge model" : "Add another model"}
                        </InputLabel>
                        <Select
                          labelId={`jm-${type}`}
                          value={pendingJudge[type] ?? ""}
                          onChange={(e) =>
                            setPendingJudge((prev) => ({ ...prev, [type]: e.target.value }))
                          }
                          label={selectedIds.length === 0 ? "Select judge model" : "Add another model"}
                        >
                          <MenuItem value=""><em>Select model</em></MenuItem>
                          {compatibleModels
                            .filter((j) => !selectedIds.includes(j.id ?? j.name))
                            .map((j) => (
                              <MenuItem key={j.id ?? j.name} value={j.id ?? j.name}>
                                {j.name}
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={!pendingJudge[type]}
                        onClick={() => addJudgeModel(type)}
                        sx={{ textTransform: "none", borderRadius: 999, px: 2, whiteSpace: "nowrap", flexShrink: 0, py: 1 }}
                      >
                        Add
                      </Button>
                    </Box>
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
        {enabledTypes.size === 0 && (
          <Typography sx={{ mt: 1.5, fontSize: "0.82rem", color: "text.secondary" }}>
            Select at least one evaluation method to continue.
          </Typography>
        )}
      </Paper>

      <Paper sx={sectionCardSx}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
          Run settings
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
          <TextField
            label="Sample Size"
            type="number"
            value={sampleSize}
            onChange={(e) => setSampleSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
            inputProps={{ min: 1, step: 1, ...(datasetQuestionCount ? { max: datasetQuestionCount } : {}) }}
            helperText={datasetQuestionCount ? `Dataset has ${datasetQuestionCount} questions total.` : "Number of dataset rows to evaluate."}
            fullWidth
          />
          <TextField
            label="Seed"
            type="number"
            value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value, 10) || 0)}
            inputProps={{ step: 1 }}
            helperText="Random seed for reproducible sampling."
            fullWidth
          />
        </Box>
      </Paper>

      <Box sx={actionRowSx}>
        <Button variant="outlined" sx={actionButtonSx} onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button
          variant="contained"
          sx={actionButtonSx}
          onClick={handleClick}
          disabled={submitting || !isValid}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {submitting ? "Starting…" : "Start Benchmark"}
        </Button>
      </Box>
    </Stack>
  );
};

const EditExperiment = ({ experiment, onBack }) => {
  const { models: allModels = [] } = React.useContext(LlmContext).llms ?? {};
  const navigate = useNavigate();
  const isPending = experiment.status === "pending";
  const [name, setName] = React.useState(experiment.name ?? "");
  const [description, setDescription] = React.useState(experiment.description ?? "");
  const [sampleSize, setSampleSize] = React.useState(experiment.sample_size ?? 50);
  const [seed, setSeed] = React.useState(experiment.seed ?? 42);
  const [measureK, setMeasureK] = React.useState(experiment.measure_k ?? 0);
  const [modelIds, setModelIds] = React.useState([...(experiment.candidate_model_ids ?? [])]);
  const [currentModelName, setCurrentModelName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleAddModel = () => {
    const item = allModels.find((m) => m.name === currentModelName);
    if (!item || modelIds.includes(item.id)) return;
    setModelIds((prev) => [...prev, item.id]);
    setCurrentModelName("");
  };

  const handleRemoveModel = (id) => {
    if (modelIds.length <= 1) { setError("An experiment must have at least one model."); return; }
    setModelIds((prev) => prev.filter((m) => m !== id));
  };

  const handleSave = async () => {
    if (isPending && !name.trim()) { setError("Experiment name is required."); return; }
    if (modelIds.length === 0) { setError("An experiment must have at least one model."); return; }
    setSaving(true);
    setError("");
    try {
      const patch = {};
      if (description !== (experiment.description ?? "")) patch.description = description || null;
      if (isPending) {
        if (name !== experiment.name) patch.name = name;
        if (sampleSize !== experiment.sample_size) patch.sample_size = sampleSize;
        if (seed !== experiment.seed) patch.seed = seed;
        if (measureK !== experiment.measure_k) patch.measure_k = measureK;
      }
      if (Object.keys(patch).length > 0) await ExperimentService.updateExperiment(experiment.id, patch);

      const toAdd = modelIds.filter((id) => !experiment.candidate_model_ids.includes(id));
      const toRemove = (experiment.candidate_model_ids ?? []).filter((id) => !modelIds.includes(id));
      for (const id of toAdd) await ExperimentService.addModel(experiment.id, id);
      for (const id of toRemove) await ExperimentService.removeModel(experiment.id, id);

      if (!isPending) {
        if (toAdd.length > 0) await ExperimentService.runExperiment(experiment.id);
        navigate(`/experiments/${experiment.id}`);
      } else {
        onBack();
      }
    } catch (err) {
      const detail = err?.data?.detail ?? err?.message ?? "Server error";
      setError(`Failed to save changes: ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const modelName = (id) => allModels.find((m) => m.id === id)?.name ?? `ID ${id}`;

  return (
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Experiments"
        title={`Edit "${experiment.name}"`}
        description={isPending ? "Update the experiment name, sample settings, and candidate models. Dataset and judges cannot be changed after creation." : "Add or remove candidate models. Saving will take you to the experiment where you can run the new models."}
      />

      <TextField
        fullWidth
        required={isPending}
        disabled={!isPending}
        label="Experiment Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        helperText={!isPending ? "Name can only be changed for pending experiments." : undefined}
      />
      <TextField
        fullWidth
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        multiline
        minRows={2}
        helperText="Optional — what are you testing?"
      />

      {isPending && (
        <Paper sx={sectionCardSx}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Run Settings</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 2 }}>
            <TextField label="Sample Size" type="number" value={sampleSize} onChange={(e) => setSampleSize(Math.max(1, parseInt(e.target.value, 10) || 1))} inputProps={{ min: 1, step: 1 }} fullWidth />
            <TextField label="Seed" type="number" value={seed} onChange={(e) => setSeed(parseInt(e.target.value, 10) || 0)} inputProps={{ step: 1 }} fullWidth />
            <TextField label="Measure K" type="number" value={measureK} onChange={(e) => setMeasureK(Math.max(0, parseInt(e.target.value, 10) || 0))} inputProps={{ min: 0, step: 1 }} fullWidth />
          </Box>
        </Paper>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" }, gap: 3 }}>
        <Paper sx={sectionCardSx}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>Candidate Models</Typography>
          {modelIds.length === 0 ? (
            <Typography sx={{ color: "text.secondary" }}>No models selected.</Typography>
          ) : (
            <Stack spacing={1}>
              {modelIds.map((id) => (
                <Box key={id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2, py: 1.25, borderRadius: 2, border: "1px solid rgba(25,118,210,0.15)", background: "rgba(25,118,210,0.04)" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: "0.9rem" }}>{modelName(id)}</Typography>
                    {(() => { const m = allModels.find((x) => x.id === id); return m ? (
                      <Tooltip placement="top" arrow title={
                        <Box sx={{ p: 0.5 }}>
                          <Typography sx={{ fontSize: "0.75rem", fontWeight: 700 }}>{m.model_name}</Typography>
                          <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)" }}>Provider: {m.provider}</Typography>
                          {m.system_prompt && <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)", maxWidth: 260, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>Prompt: {m.system_prompt.length > 120 ? m.system_prompt.slice(0, 120) + "…" : m.system_prompt}</Typography>}
                        </Box>
                      }>
                        <Box component="span" sx={{ color: "text.disabled", cursor: "help", fontSize: "0.8rem", userSelect: "none", lineHeight: 1 }}>ℹ</Box>
                      </Tooltip>
                    ) : null; })()}
                  </Box>
                  <Button size="small" color="error" disabled={modelIds.length <= 1} sx={{ textTransform: "none", borderRadius: 999, minWidth: 0, px: 1.5 }} onClick={() => handleRemoveModel(id)}>Remove</Button>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>

        <Paper sx={{ ...sectionCardSx, background: "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(243,249,255,1) 100%)" }}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Add a model</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 1.5, alignItems: "center" }}>
            <FormControl fullWidth>
              <InputLabel id="edit-model-select-label">Model</InputLabel>
              <Select labelId="edit-model-select-label" value={currentModelName} onChange={(e) => setCurrentModelName(e.target.value)} label="Model">
                <MenuItem value=""><em>Select a model</em></MenuItem>
                {allModels.map((m) => (
                  <MenuItem key={m.id} value={m.name}>{m.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" sx={actionButtonSx} onClick={handleAddModel} disabled={!currentModelName}>Add Model</Button>
          </Box>
        </Paper>
      </Box>

      <ErrorSnackbar message={error} onClose={() => setError("")} />
      <Box sx={actionRowSx}>
        <Button variant="outlined" sx={actionButtonSx} onClick={onBack} disabled={saving}>Back</Button>
        <Button variant="contained" sx={actionButtonSx} onClick={handleSave} disabled={saving} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </Box>
    </Stack>
  );
};

const Experiments = () => {
  const [stage, setStage] = React.useState(0);
  const [maxStage, setMaxStage] = React.useState(0);
  const [editingExp, setEditingExp] = React.useState(null);
  const [listVersion, setListVersion] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState("");
  const [data, setData] = React.useState({
    name: "",
    description: "",
    system_prompt_override: "",
    models: [],
    dataset: {},
  });

  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    if (location.state?.editExp) {
      setEditingExp(location.state.editExp);
      window.history.replaceState({}, "");
    }
  }, []);

  const handleFinish = async ({ judgeConfigs, sampleSize, seed }) => {
    setSubmitting(true);
    try {
      const datasetId = data.dataset.id;
      const candidateModelIds = (data.models ?? []).map((m) => m.id);

      const createRes = await ExperimentService.createExperiment({
        name: data.name || "Untitled Experiment",
        description: data.description || null,
        system_prompt_override: data.system_prompt_override?.trim() || null,
        datasetId,
        candidateModelIds,
        sample_size: sampleSize,
        seed,
        judge_configs: judgeConfigs.map((cfg) => ({
          judge_type: cfg.judgeType,
          judge_model_id: cfg.judgeModelId ?? null,
        })),
      });
      const newId = createRes.data?.id;

      await ExperimentService.runExperiment(newId);
      navigate(`/experiments/${newId}`);
    } catch (err) {
      const detail = err?.data?.detail ?? err?.message ?? "Server error";
      setSubmitError(`Failed to start experiment: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    setStage((prev) => {
      const next = prev + 1;
      setMaxStage((m) => Math.max(m, next));
      return next;
    });
  };

  const handleBack = () => {
    setStage((prevStage) => Math.max(prevStage - 1, 0));
  };

  const handleDataset = (dataset) => {
    setData((prevState) => ({
      ...prevState,
      dataset,
    }));
    handleNext();
  };

  const stages = {
    0: <DefaultPage onClick={handleNext} onEdit={(exp) => setEditingExp(exp)} listVersion={listVersion} />,
    1: (
      <ConfigureModel
        selectedModels={data.models}
        setData={setData}
        onBack={handleBack}
        onClick={handleNext}
        experimentName={data.name}
        experimentDescription={data.description}
        systemPromptOverride={data.system_prompt_override}
      />
    ),
    2: <ConfigureDataset onBack={handleBack} onClick={handleDataset} />,
    3: (
      <ConfigureOptions
        datasetType={data.dataset.type}
        datasetQuestionCount={data.dataset.number_of_questions ?? null}
        onBack={handleBack}
        onFinish={handleFinish}
        submitting={submitting}
      />
    ),
  };

  if (editingExp) {
    return (
      <Box sx={pageShellSx}>
        <Paper sx={wizardFrameSx}>
          <EditExperiment experiment={editingExp} onBack={() => { setEditingExp(null); setListVersion((v) => v + 1); }} />
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={pageShellSx}>
      <Paper sx={wizardFrameSx}>
        {stage >= 1 && <StageChips stage={stage} maxStage={maxStage} onStageClick={setStage} />}
        <ErrorSnackbar message={submitError} onClose={() => setSubmitError("")} />
        {stages[stage]}
      </Paper>
    </Box>
  );
};

export default Experiments;