import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { DataGrid } from "@mui/x-data-grid";
import React from "react";
import DatasetService from "../api/services/dataset";
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
  justifyContent: "space-between",
  alignItems: "center",
  gap: 1.5,
  flexWrap: "wrap",
};

const datasetTypeOptions = ["mc_with_true", "open_with_true", "no_true_answer"];
const DATASET_TYPE_LABELS = {
  mc_with_true: "Multiple Choice",
  open_with_true: "Open Answer with Reference",
  no_true_answer: "Open Answer",
};

const DATASET_TYPE_INFO = {
  open_with_true: {
    description: "Questions with a reference answer to compare against.",
    judges: ["Exact Match", "Contains", "JSON Match", "LLM Binary", "LLM Scoring", "Similarity"],
  },
  mc_with_true: {
    description: "Multiple choice questions with a correct option letter.",
    judges: ["Exact Match", "LLM Binary", "LLM Scoring"],
  },
  no_true_answer: {
    description: "Open-ended questions with no reference answer.",
    judges: ["LLM Binary", "LLM Scoring"],
  },
};

const DatasetTypeInfo = ({ datasetType }) => {
  const info = DATASET_TYPE_INFO[datasetType];
  if (!info) return null;
  return (
    <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: "rgba(25,118,210,0.04)", border: "1px solid rgba(25,118,210,0.12)" }}>
      <Typography sx={{ fontSize: "0.82rem", color: "text.secondary", mb: 1 }}>
        {info.description}
      </Typography>
      <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }}>
        Available judges
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {info.judges.map((j) => (
          <Chip key={j} label={j} size="small" variant="outlined" sx={{ borderRadius: 1, fontSize: "0.72rem" }} />
        ))}
      </Box>
    </Box>
  );
};

const STATUS_COLOR = { ready: "success", uploaded: "warning" };

const parseCSVHeaders = (line) => {
  const headers = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { headers.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  if (current.trim()) headers.push(current.trim());
  return headers.filter(Boolean);
};

const CLIENT_AUTO_NAMES = {
  question:    ["question", "prompt", "text", "query"],
  answer:      ["true_answer", "answer", "correct_answer", "ground_truth"],
  options:     ["options", "choices"],
  category:    ["category", "cat", "topic", "subject"],
  question_id: ["question_id", "q_id", "id", "qid"],
};

const autoFillMappings = (columns) => {
  const colSet = new Set(columns);
  const result = { question: "", answer: "", options: "", category: "", question_id: "" };
  for (const [role, variants] of Object.entries(CLIENT_AUTO_NAMES)) {
    for (const v of variants) {
      if (colSet.has(v)) { result[role] = v; break; }
    }
  }
  if (result.question_id === "_auto_question_id") result.question_id = "";
  return result;
};

const EMPTY_MAPPINGS = { question: "", answer: "", options: "", category: "", question_id: "" };

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

// Shown before a file is selected — lists recognizable column names per role
const AutoDetectHint = ({ datasetType }) => {
  const required =
    datasetType === "mc_with_true"
      ? [
          { role: "Question", names: CLIENT_AUTO_NAMES.question },
          { role: "Answer",   names: CLIENT_AUTO_NAMES.answer },
          { role: "Options",  names: CLIENT_AUTO_NAMES.options },
        ]
      : datasetType === "open_with_true"
      ? [
          { role: "Question", names: CLIENT_AUTO_NAMES.question },
          { role: "Answer",   names: CLIENT_AUTO_NAMES.answer },
        ]
      : datasetType === "no_true_answer"
      ? [{ role: "Question", names: CLIENT_AUTO_NAMES.question }]
      : [
          { role: "Question", names: CLIENT_AUTO_NAMES.question },
          { role: "Answer",   names: CLIENT_AUTO_NAMES.answer },
          { role: "Options",  names: CLIENT_AUTO_NAMES.options },
        ];

  const optional = [
    { role: "Category",    names: CLIENT_AUTO_NAMES.category },
    { role: "Question ID", names: CLIENT_AUTO_NAMES.question_id },
  ];

  const NameRow = ({ role, names, muted }) => (
    <Stack direction="row" alignItems="flex-start" spacing={1.5}>
      <Typography
        sx={{ fontSize: "0.8rem", color: muted ? "text.disabled" : "text.secondary", width: 88, flexShrink: 0, pt: 0.3 }}
      >
        {role}
      </Typography>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {names.map((n) => (
          <Chip
            key={n}
            label={n}
            size="small"
            sx={{ borderRadius: 1, fontSize: "0.72rem", fontFamily: "monospace", height: 22 }}
          />
        ))}
      </Stack>
    </Stack>
  );

  return (
    <Stack spacing={2}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>Column Auto-Detection</Typography>
      <Typography sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
        If your CSV uses any of the following column names, mapping is handled automatically on upload — no manual selection needed.
      </Typography>
      <Stack spacing={0.5}>
        <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.5 }}>
          {datasetType ? "Required" : "Common"}
        </Typography>
        {required.map(({ role, names }) => (
          <NameRow key={role} role={role} names={names} />
        ))}
      </Stack>
      <Stack spacing={0.5}>
        <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.5 }}>
          Optional
        </Typography>
        {optional.map(({ role, names }) => (
          <NameRow key={role} role={role} names={names} muted />
        ))}
      </Stack>
    </Stack>
  );
};

// Shown when columns were auto-detected — compact summary instead of full form
const MappingSummary = ({ columnMappings, datasetType, onCustomize }) => {
  const pairs = [
    columnMappings.question                                        && { label: "Question",    value: columnMappings.question },
    datasetType !== "no_true_answer" && columnMappings.answer     && { label: "Answer",       value: columnMappings.answer },
    datasetType === "mc_with_true"   && columnMappings.options    && { label: "Options",      value: columnMappings.options },
    columnMappings.category                                        && { label: "Category",     value: columnMappings.category },
    columnMappings.question_id                                     && { label: "Question ID",  value: columnMappings.question_id },
  ].filter(Boolean);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Column Mapping</Typography>
        <Chip label="Auto-detected" color="success" size="small" variant="outlined" sx={{ borderRadius: 999 }} />
      </Stack>
      <Box
        sx={{
          p: 2,
          borderRadius: 2,
          bgcolor: "rgba(76,175,80,0.06)",
          border: "1px solid rgba(76,175,80,0.2)",
        }}
      >
        <Stack spacing={0.75}>
          {pairs.map(({ label, value }) => (
            <Stack key={label} direction="row" spacing={1.5} alignItems="center">
              <Typography sx={{ fontSize: "0.82rem", color: "text.secondary", width: 88, flexShrink: 0 }}>
                {label}
              </Typography>
              <Chip
                label={value}
                size="small"
                sx={{ borderRadius: 1, fontSize: "0.78rem", fontFamily: "monospace", height: 22 }}
              />
            </Stack>
          ))}
        </Stack>
      </Box>
      <Button
        size="small"
        variant="text"
        onClick={onCustomize}
        sx={{ alignSelf: "flex-start", textTransform: "none", fontWeight: 600, px: 0 }}
      >
        Customize mappings
      </Button>
    </Stack>
  );
};

// Full mapping form — used when columns aren't auto-detected or user wants to override
const ColumnMappingFields = ({ datasetType, columnMappings, onChange, availableColumns = [] }) => {
  if (!datasetType) return null;

  const ColumnField = ({ label, name, required = false, helperText }) =>
    availableColumns.length > 0 ? (
      <FormControl fullWidth required={required}>
        <InputLabel>{label}</InputLabel>
        <Select
          name={name}
          value={columnMappings[name] ?? ""}
          label={label}
          onChange={onChange}
        >
          <MenuItem value=""><em>None</em></MenuItem>
          {availableColumns.map((c) => (
            <MenuItem key={c} value={c}>{c}</MenuItem>
          ))}
        </Select>
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
      </FormControl>
    ) : (
      <TextField
        label={label}
        name={name}
        value={columnMappings[name] ?? ""}
        onChange={onChange}
        fullWidth
        required={required}
        helperText={helperText}
      />
    );

  return (
    <Stack spacing={2}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>Column Mapping</Typography>
      <ColumnField
        label="Question Column"
        name="question"
        required
        helperText="CSV column that contains the question text."
      />
      {datasetType !== "no_true_answer" && (
        <ColumnField label="Answer Column" name="answer" required />
      )}
      {datasetType === "mc_with_true" && (
        <ColumnField label="Options Column" name="options" required />
      )}
      <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 600, mt: 0.5 }}>
        Optional
      </Typography>
      <ColumnField
        label="Category Column"
        name="category"
        helperText="Enables per-category score breakdown in experiment results."
      />
      <ColumnField
        label="Question ID Column"
        name="question_id"
        helperText="Unique row identifier. Auto-generated (1, 2, 3…) if not provided."
      />
    </Stack>
  );
};

const AddDataset = ({ setDatasets, onBack }) => {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [datasetType, setDatasetType] = React.useState("");
  const [file, setFile] = React.useState(null);
  const [fileColumns, setFileColumns] = React.useState([]);
  const [columnMappings, setColumnMappings] = React.useState({ ...EMPTY_MAPPINGS });
  const [autoMapped, setAutoMapped] = React.useState(false);
  const [showMappingForm, setShowMappingForm] = React.useState(false);
  const [error, setError] = React.useState("");
  const [uploading, setUploading] = React.useState(false);

  const applyAutoFill = (columns, type) => {
    const filled = type ? autoFillMappings(columns) : { ...EMPTY_MAPPINGS };
    setColumnMappings(filled);
    const detected = filled.question !== "";
    setAutoMapped(detected);
    setShowMappingForm(!detected);
  };

  const handleTypeChange = (e) => {
    setDatasetType(e.target.value);
    applyAutoFill(fileColumns, e.target.value);
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (!f) {
      setFileColumns([]);
      setColumnMappings({ ...EMPTY_MAPPINGS });
      setAutoMapped(false);
      setShowMappingForm(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target.result ?? "").replace(/^﻿/, "");
      const firstLine = text.split(/\r?\n/)[0];
      const headers = parseCSVHeaders(firstLine);
      setFileColumns(headers);
      applyAutoFill(headers, datasetType);
    };
    reader.readAsText(f.slice(0, 4096));
  };

  const handleColumnChange = (e) => {
    setColumnMappings((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !datasetType || !file) {
      setError("Name, question type, and a CSV file are all required.");
      return;
    }
    if (!columnMappings.question.trim()) {
      setError("Please select the question column from your CSV.");
      return;
    }
    setError("");
    setUploading(true);
    try {
      const uploadRes = await DatasetService.uploadDataset({ name, datasetType, file, description });
      const datasetId = uploadRes?.data?.id;
      if (datasetId) {
        await DatasetService.mapColumns(datasetId, columnMappings);
      }
      const listRes = await DatasetService.getDatasets();
      setDatasets(listRes?.data ?? []);
      onBack();
    } catch (err) {
      const detail = err?.response?.data?.detail ?? err?.data?.detail ?? err?.message;
      setError(detail ? `Upload failed: ${detail}` : "Failed to upload dataset. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const rightPanel = () => {
    if (autoMapped && !showMappingForm) {
      return (
        <MappingSummary
          columnMappings={columnMappings}
          datasetType={datasetType}
          onCustomize={() => setShowMappingForm(true)}
        />
      );
    }
    if (datasetType && fileColumns.length > 0) {
      return (
        <ColumnMappingFields
          datasetType={datasetType}
          columnMappings={columnMappings}
          onChange={handleColumnChange}
          availableColumns={fileColumns}
        />
      );
    }
    return <AutoDetectHint datasetType={datasetType} />;
  };

  return (
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Datasets"
        title="Upload a new dataset"
        description="Provide a CSV file, set the question type, and map the relevant column names."
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" },
          gap: 3,
        }}
      >
        <Paper sx={sectionCardSx}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
            File &amp; Metadata
          </Typography>
          <Stack spacing={2.5}>
            <TextField
              label="Dataset Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
            <FormControl fullWidth required>
              <InputLabel id="add-dataset-type-label">Question Type</InputLabel>
              <Select
                labelId="add-dataset-type-label"
                value={datasetType}
                label="Question Type"
                onChange={handleTypeChange}
              >
                {datasetTypeOptions.map((option) => (
                  <MenuItem key={option} value={option}>
                    {DATASET_TYPE_LABELS[option] ?? option}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <DatasetTypeInfo datasetType={datasetType} />
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button variant="outlined" component="label" sx={actionButtonSx}>
                Upload CSV
                <input
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                />
              </Button>
              {file && (
                <Chip
                  label={file.name}
                  color="primary"
                  variant="outlined"
                  sx={{ borderRadius: 999 }}
                />
              )}
            </Stack>
          </Stack>
        </Paper>
        <Paper
          sx={{
            ...sectionCardSx,
            background:
              "linear-gradient(180deg, rgba(252,254,255,1) 0%, rgba(241,247,255,1) 100%)",
          }}
        >
          {rightPanel()}
        </Paper>
      </Box>
      <ErrorSnackbar message={error} onClose={() => setError("")} />
      <Box sx={actionRowSx}>
        <Button
          variant="outlined"
          sx={actionButtonSx}
          onClick={onBack}
          disabled={uploading}
        >
          Back
        </Button>
        <Button
          variant="contained"
          sx={actionButtonSx}
          onClick={handleSubmit}
          disabled={uploading}
          startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {uploading ? "Uploading…" : "Save Dataset"}
        </Button>
      </Box>
    </Stack>
  );
};

const EditDataset = ({ dataset, setDatasets, onBack }) => {
  const [name, setName] = React.useState(dataset.name ?? "");
  const [description, setDescription] = React.useState(dataset.description ?? "");
  const datasetType = dataset.dataset_type ?? "";
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Dataset name is required.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await DatasetService.updateDataset(dataset.id, { name, description });
      const listRes = await DatasetService.getDatasets();
      setDatasets(listRes?.data ?? []);
      onBack();
    } catch (err) {
      const detail = err?.response?.data?.detail ?? err?.data?.detail ?? err?.message;
      setError(detail ? `Save failed: ${detail}` : "Failed to update dataset.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <StageHeader
        eyebrow="Datasets"
        title="Edit dataset"
        description="Update the dataset name or description."
      />
      <Paper sx={{ ...sectionCardSx, maxWidth: 560 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
          Metadata
        </Typography>
        <Stack spacing={2.5}>
          <TextField
            label="Dataset Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <TextField
            label="Question Type"
            value={DATASET_TYPE_LABELS[datasetType] ?? datasetType}
            fullWidth
            disabled
            helperText="Dataset type cannot be changed after upload."
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontSize: "0.85rem", color: "text.secondary" }}>Status:</Typography>
            <Chip
              label={dataset.status === "ready" ? "Ready" : "Mapping required"}
              color={STATUS_COLOR[dataset.status] ?? "default"}
              size="small"
              variant="outlined"
              sx={{ borderRadius: 999 }}
            />
            {dataset.number_of_questions > 0 && (
              <Typography sx={{ fontSize: "0.85rem", color: "text.secondary" }}>
                {dataset.number_of_questions} questions
              </Typography>
            )}
          </Stack>
        </Stack>
      </Paper>
      <ErrorSnackbar message={error} onClose={() => setError("")} />
      <Box sx={actionRowSx}>
        <Button
          variant="outlined"
          sx={actionButtonSx}
          onClick={onBack}
          disabled={saving}
        >
          Back
        </Button>
        <Button
          variant="contained"
          sx={actionButtonSx}
          onClick={handleSubmit}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </Box>
    </Stack>
  );
};

const Datasets = () => {
  const [view, setView] = React.useState("list");
  const [datasets, setDatasets] = React.useState([]);
  const [editingDataset, setEditingDataset] = React.useState(null);
  const [deleteError, setDeleteError] = React.useState("");

  React.useEffect(() => {
    DatasetService.getDatasets()
      .then((res) => setDatasets(res?.data ?? []))
      .catch(() => {});
  }, []);

  const handleDelete = async (id) => {
    try {
      await DatasetService.deleteDataset(id);
      setDatasets((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setDeleteError("Failed to delete dataset.");
    }
  };

  const handleEdit = (dataset) => {
    setEditingDataset(dataset);
    setView("edit");
  };

  const [typeFilter, setTypeFilter] = React.useState("");

  const filteredDatasets = React.useMemo(() => {
    const rows = typeFilter ? datasets.filter((d) => d.dataset_type === typeFilter) : [...datasets];
    return rows.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [datasets, typeFilter]);

  const cols = [
    {
      field: "name",
      headerName: "Name",
      flex: 1,
      minWidth: 160,
      renderCell: (params) => (
        <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", py: 1 }}>
          <Typography sx={{ fontSize: "0.875rem", fontWeight: 500 }}>{params.value}</Typography>
          {params.row.description && (
            <Typography sx={{ fontSize: "0.8rem", color: "text.secondary", lineHeight: 1.4, mt: 0.25 }}>
              {params.row.description}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      field: "dataset_type",
      headerName: "Type",
      flex: 1,
      minWidth: 160,
      sortable: false,
      disableColumnMenu: true,
      valueFormatter: (value) => DATASET_TYPE_LABELS[value] ?? value,
    },
    {
      field: "number_of_questions",
      headerName: "Questions",
      width: 110,
      type: "number",
      disableColumnMenu: true,
      valueFormatter: (value) => (value > 0 ? value : "–"),
    },
    {
      field: "_actions",
      headerName: "",
      width: 180,
      sortable: false,
      disableColumnMenu: true,
      renderCell: (params) => (
        <Stack direction="row" spacing={1} sx={{ height: "100%", alignItems: "center", pl: 2 }}>
          <Button
            size="small"
            variant="outlined"
            sx={{ textTransform: "none", borderRadius: 999, minWidth: 0, px: 1.5, py: 0.25, fontSize: "0.78rem" }}
            onClick={() => handleEdit(params.row)}
          >
            Edit
          </Button>
          <Button
            size="small"
            color="error"
            variant="outlined"
            sx={{ textTransform: "none", borderRadius: 999, minWidth: 0, px: 1.5, py: 0.25, fontSize: "0.78rem" }}
            onClick={() => handleDelete(params.row.id)}
          >
            Delete
          </Button>
          <Tooltip title="Download CSV" placement="top" arrow>
            <IconButton
              size="small"
              sx={{ color: "text.secondary" }}
              onClick={() =>
                DatasetService.downloadDataset(params.row.id, params.row.name).catch(() =>
                  setDeleteError("Download failed.")
                )
              }
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  if (view === "add") {
    return (
      <Box sx={pageShellSx}>
        <Paper sx={frameSx}>
          <AddDataset setDatasets={setDatasets} onBack={() => setView("list")} />
        </Paper>
      </Box>
    );
  }

  if (view === "edit" && editingDataset) {
    return (
      <Box sx={pageShellSx}>
        <Paper sx={frameSx}>
          <EditDataset
            dataset={editingDataset}
            setDatasets={setDatasets}
            onBack={() => setView("list")}
          />
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={pageShellSx}>
      <Paper sx={frameSx}>
        <Stack spacing={3}>
          <StageHeader
            eyebrow="Datasets"
            title="Saved datasets"
            description="Upload CSV files and configure column mappings for your benchmark experiments."
          />
          <ErrorSnackbar message={deleteError} onClose={() => setDeleteError("")} />
          <Paper sx={sectionCardSx}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Saved Datasets
              </Typography>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel id="type-filter-label">Filter by type</InputLabel>
                  <Select
                    labelId="type-filter-label"
                    value={typeFilter}
                    label="Filter by type"
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <MenuItem value="">All types</MenuItem>
                    {datasetTypeOptions.map((opt) => (
                      <MenuItem key={opt} value={opt}>{DATASET_TYPE_LABELS[opt]}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  variant="contained"
                  sx={actionButtonSx}
                  onClick={() => setView("add")}
                >
                  Add Dataset
                </Button>
              </Stack>
            </Stack>
            <DataGrid
              rows={filteredDatasets}
              columns={cols}
              disableRowSelectionOnClick
              disableColumnMenu
              getRowHeight={() => "auto"}
              autoHeight
              sx={{
                borderRadius: 3,
                borderColor: "rgba(25,118,210,0.12)",
                "& .MuiDataGrid-columnHeaders": {
                  backgroundColor: "rgba(25,118,210,0.06)",
                },
              }}
            />
          </Paper>
        </Stack>
      </Paper>
    </Box>
  );
};

export default Datasets;
