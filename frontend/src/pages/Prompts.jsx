import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DoneOutlinedIcon from "@mui/icons-material/DoneOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PromptService from "../api/services/prompt";
import ApiKeyService from "../api/services/apiKey";
import { VendorModelSelector } from "../components/VendorModelParams";

const DATASET_LABELS = {
  mc_with_true: "Multiple Choice",
  open_with_true: "Open Answer with Reference",
  no_true_answer: "Open Answer",
};
const EVAL_LABELS = {
  equals: "Equals",
  contains: "Contains",
  json_equals: "JSON Equals",
  similarity: "Similarity",
  llm_bool: "LLM Binary",
  llm_score: "LLM Score",
};

const EVAL_OPTIONS = [
  { value: "", label: "All eval types" },
  ...Object.entries(EVAL_LABELS).map(([v, l]) => ({ value: v, label: l })),
];
const DATASET_OPTIONS = [
  { value: "", label: "All dataset types" },
  ...Object.entries(DATASET_LABELS).map(([v, l]) => ({ value: v, label: l })),
];
const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "model", label: "Model" },
  { value: "judge", label: "Judge" },
];
const JUDGE_MODE_OPTIONS = [
  { value: "", label: "Any mode" },
  { value: "boolean", label: "Binary" },
  { value: "score", label: "Score" },
];

const NEEDS_REFERENCE = new Set(["equals", "contains", "json_equals", "similarity"]);

const emptyForm = {
  name: "",
  content: "",
  prompt_type: "model",
  dataset_type: "",
  eval_type: "",
  judge_mode: "",
  score_min: "",
  score_max: "",
  correct_tokens: "",
  incorrect_tokens: "",
};

function GeneratePanel({ form, onGenerated }) {
  const [open, setOpen] = React.useState(false);
  const [vendor, setVendor] = React.useState("openai");
  const [model, setModel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [savedKeys, setSavedKeys] = React.useState([]);
  const [keyId, setKeyId] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [genError, setGenError] = React.useState("");

  React.useEffect(() => {
    ApiKeyService.getKeys()
      .then((res) => setSavedKeys(res?.data ?? []))
      .catch(() => {});
  }, []);

  const handleVendorChange = (v) => {
    setVendor(v);
    setModel("");
    setKeyId("");
  };

  const keysForVendor = savedKeys.filter((k) => k.vendor === vendor);
  const isLocal = vendor === "local";

  const handleGenerate = async () => {
    if (!model.trim()) { setGenError("Select a model"); return; }
    if (!isLocal && !keyId) { setGenError("Select an API key"); return; }
    if (!description.trim()) { setGenError("Describe the prompt"); return; }
    setGenError("");
    setGenerating(true);
    try {
      const res = await PromptService.generatePrompt({
        vendor,
        model_name: model,
        api_key_id: keyId ? Number(keyId) : null,
        base_url: isLocal ? baseUrl : null,
        prompt_type: form.prompt_type,
        dataset_type: form.dataset_type || null,
        eval_type: form.eval_type || null,
        judge_mode: form.judge_mode || null,
        score_min: form.score_min !== "" ? Number(form.score_min) : null,
        score_max: form.score_max !== "" ? Number(form.score_max) : null,
        correct_tokens: form.correct_tokens ? form.correct_tokens.split(",").map((s) => s.trim()).filter(Boolean) : null,
        incorrect_tokens: form.incorrect_tokens ? form.incorrect_tokens.split(",").map((s) => s.trim()).filter(Boolean) : null,
        description: description.trim(),
      });
      onGenerated(res?.data?.content ?? "");
      setOpen(false);
      setDescription("");
    } catch (e) {
      setGenError(e?.data?.detail ?? e?.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Box sx={{ border: "1px solid rgba(25,118,210,0.18)", borderRadius: 2, overflow: "hidden" }}>
      <Box
        onClick={() => setOpen((x) => !x)}
        sx={{
          display: "flex", alignItems: "center", gap: 1, px: 1.75, py: 1.1,
          cursor: "pointer", bgcolor: open ? "rgba(25,118,210,0.06)" : "rgba(25,118,210,0.03)",
          "&:hover": { bgcolor: "rgba(25,118,210,0.08)" }, transition: "background 0.12s",
        }}
      >
        <AutoAwesomeOutlinedIcon sx={{ fontSize: 16, color: "#1565c0" }} />
        <Typography sx={{ fontSize: "0.82rem", fontWeight: 600, color: "#1565c0", flex: 1 }}>
          Generate with AI
        </Typography>
        <Typography sx={{ fontSize: "0.72rem", color: "rgba(25,118,210,0.6)" }}>{open ? "▲" : "▼"}</Typography>
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 2, py: 2, display: "flex", flexDirection: "column", gap: 1.75, borderTop: "1px solid rgba(25,118,210,0.1)" }}>
          <VendorModelSelector
            vendor={vendor}
            model={model}
            onVendorChange={handleVendorChange}
            onModelChange={setModel}
            baseUrl={baseUrl}
          />
          {isLocal ? (
            <TextField label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              size="small" fullWidth placeholder="http://localhost:11434/v1" />
          ) : (
            <FormControl size="small" fullWidth>
              <InputLabel>API Key</InputLabel>
              <Select value={keyId} onChange={(e) => setKeyId(e.target.value)} label="API Key">
                <MenuItem value=""><em>Select saved key…</em></MenuItem>
                {keysForVendor.map((k) => (
                  <MenuItem key={k.id} value={String(k.id)}>{k.label} ({k.masked})</MenuItem>
                ))}
              </Select>
              {keysForVendor.length === 0 && (
                <Typography sx={{ fontSize: "0.72rem", color: "text.secondary", mt: 0.5 }}>
                  No saved keys for this vendor. Add one in API Keys settings.
                </Typography>
              )}
            </FormControl>
          )}
          <TextField
            label="Describe what you want"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
            size="small"
            fullWidth
            placeholder="e.g. A judge that checks if a translation preserves the original meaning and tone"
          />
          {genError && <Typography sx={{ color: "error.main", fontSize: "0.78rem" }}>{genError}</Typography>}
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={generating}
            startIcon={<AutoAwesomeOutlinedIcon sx={{ fontSize: 15 }} />}
            sx={{ textTransform: "none", borderRadius: 999, alignSelf: "flex-start", fontSize: "0.82rem" }}
          >
            {generating ? "Generating…" : "Generate"}
          </Button>
        </Box>
      </Collapse>
    </Box>
  );
}

function PromptFormDialog({ open, onClose, onSave, initial }) {
  const [form, setForm] = React.useState(emptyForm);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (open) {
      if (initial) {
        setForm({
          name: initial.name ?? "",
          content: initial.content ?? "",
          prompt_type: initial.prompt_type ?? "model",
          dataset_type: initial.dataset_type ?? "",
          eval_type: initial.eval_type ?? "",
          judge_mode: initial.judge_mode ?? "",
          score_min: initial.score_min != null ? String(initial.score_min) : "",
          score_max: initial.score_max != null ? String(initial.score_max) : "",
          correct_tokens: (initial.correct_tokens ?? []).join(", "),
          incorrect_tokens: (initial.incorrect_tokens ?? []).join(", "),
        });
      } else {
        setForm(emptyForm);
      }
      setError("");
    }
  }, [open, initial]);

  const set = (k) => (e) => {
    const val = e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: val };
      if (k === "dataset_type" && val === "no_true_answer" && NEEDS_REFERENCE.has(next.eval_type)) {
        next.eval_type = "";
      }
      if (k === "eval_type" && NEEDS_REFERENCE.has(val) && next.dataset_type === "no_true_answer") {
        next.dataset_type = "";
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (!form.content.trim()) { setError("Content is required"); return; }
    setSaving(true);
    setError("");
    try {
      const judgeEvalType = form.judge_mode === "boolean" ? "llm_bool" : form.judge_mode === "score" ? "llm_score" : null;
      const payload = {
        name: form.name.trim(),
        content: form.content.trim(),
        prompt_type: form.prompt_type,
        dataset_type: form.dataset_type || null,
        eval_type: form.prompt_type === "judge" ? judgeEvalType : (form.eval_type || null),
        judge_mode: form.prompt_type === "judge" ? (form.judge_mode || null) : null,
        score_min: form.score_min !== "" ? Number(form.score_min) : null,
        score_max: form.score_max !== "" ? Number(form.score_max) : null,
        correct_tokens: form.correct_tokens
          ? form.correct_tokens.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        incorrect_tokens: form.incorrect_tokens
          ? form.incorrect_tokens.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
      };
      await onSave(payload);
      onClose();
    } catch (e) {
      setError(e?.data?.detail ?? e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const isJudge = form.prompt_type === "judge";
  const isScore = isJudge && form.judge_mode === "score";
  const isBool = isJudge && form.judge_mode === "boolean";
  const evalBlocksNoRef = NEEDS_REFERENCE.has(form.eval_type);
  const datasetBlocksExact = form.dataset_type === "no_true_answer";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 4, maxHeight: "92vh" } }}>
      <Box sx={{ px: 3, pt: 3, pb: 1.5, borderBottom: "1px solid rgba(15,23,42,0.07)", flexShrink: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: "1.05rem" }}>
          {initial ? "Edit Prompt" : "New Prompt"}
        </Typography>
      </Box>
      <Box sx={{ px: 3, py: 2, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
        <TextField label="Name" value={form.name} onChange={set("name")} fullWidth size="small" />

        {/* Type + dataset (model) or just type (judge) */}
        <Stack direction="row" spacing={1.5}>
          <FormControl size="small" fullWidth>
            <InputLabel>Type</InputLabel>
            <Select value={form.prompt_type} onChange={set("prompt_type")} label="Type">
              <MenuItem value="model">Model</MenuItem>
              <MenuItem value="judge">Judge</MenuItem>
            </Select>
          </FormControl>
          {!isJudge && (
            <FormControl size="small" fullWidth>
              <InputLabel>Dataset type</InputLabel>
              <Select value={form.dataset_type} onChange={set("dataset_type")} label="Dataset type">
                <MenuItem value=""><em>Any</em></MenuItem>
                {Object.entries(DATASET_LABELS).map(([v, l]) => (
                  <MenuItem key={v} value={v} disabled={evalBlocksNoRef && v === "no_true_answer"}>{l}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {!isJudge && (
            <FormControl size="small" fullWidth>
              <InputLabel>Eval type</InputLabel>
              <Select value={form.eval_type} onChange={set("eval_type")} label="Eval type">
                <MenuItem value=""><em>Any</em></MenuItem>
                {Object.entries(EVAL_LABELS).map(([v, l]) => (
                  <MenuItem key={v} value={v} disabled={datasetBlocksExact && NEEDS_REFERENCE.has(v)}>{l}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Stack>
        {isJudge && (
          <FormControl size="small" fullWidth>
            <InputLabel>Judge mode</InputLabel>
            <Select value={form.judge_mode} onChange={set("judge_mode")} label="Judge mode">
              <MenuItem value=""><em>None</em></MenuItem>
              <MenuItem value="boolean">Binary</MenuItem>
              <MenuItem value="score">Score</MenuItem>
            </Select>
          </FormControl>
        )}
        {isScore && (
          <Stack direction="row" spacing={1.5}>
            <TextField label="Score min" value={form.score_min} onChange={set("score_min")} size="small" type="number" fullWidth />
            <TextField label="Score max" value={form.score_max} onChange={set("score_max")} size="small" type="number" fullWidth />
          </Stack>
        )}
        {isBool && (
          <Stack direction="row" spacing={1.5}>
            <TextField label="Positive tokens" placeholder="e.g. yes, true" value={form.correct_tokens} onChange={set("correct_tokens")} size="small" fullWidth />
            <TextField label="Negative tokens" placeholder="e.g. no, false" value={form.incorrect_tokens} onChange={set("incorrect_tokens")} size="small" fullWidth />
          </Stack>
        )}

        {/* Generate panel */}
        <GeneratePanel form={form} onGenerated={(content) => setForm((f) => ({ ...f, content }))} />

        {/* Content — always editable */}
        <TextField
          label="Content"
          value={form.content}
          onChange={set("content")}
          fullWidth
          multiline
          minRows={4}
          size="small"
          placeholder="Write directly or generate above…"
        />

        {error && <Typography sx={{ color: "error.main", fontSize: "0.82rem" }}>{error}</Typography>}
      </Box>
      <Box sx={{ px: 3, py: 2, borderTop: "1px solid rgba(15,23,42,0.07)", display: "flex", justifyContent: "flex-end", gap: 1, flexShrink: 0 }}>
        <Button onClick={onClose} sx={{ textTransform: "none", color: "text.secondary" }}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ textTransform: "none", borderRadius: 999 }}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </Box>
    </Dialog>
  );
}

const DATASET_SHORT = {
  mc_with_true: "MC",
  open_with_true: "With ref",
  no_true_answer: "No ref",
};
const EVAL_SHORT = {
  equals: "Equals",
  contains: "Contains",
  json_equals: "JSON",
  similarity: "Similarity",
  llm_bool: "Binary",
  llm_score: "Score",
};

function PromptRow({ prompt, onEdit, onDelete }) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const isModel = prompt.prompt_type === "model";
  const accent = isModel ? "#1565c0" : "#7b1fa2";

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(prompt.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const tags = [];
  if (prompt.dataset_type) tags.push({ label: DATASET_SHORT[prompt.dataset_type] ?? prompt.dataset_type, color: "info" });
  if (prompt.eval_type) {
    let evalLabel = EVAL_SHORT[prompt.eval_type] ?? prompt.eval_type;
    if (prompt.eval_type === "llm_score" && prompt.score_min != null && prompt.score_max != null) {
      evalLabel = `Score ${prompt.score_min}–${prompt.score_max}`;
    }
    tags.push({ label: evalLabel, color: "success" });
  }

  return (
    <Box
      onClick={() => setExpanded((x) => !x)}
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 2,
        px: 2.5,
        py: 2,
        borderLeft: `3px solid ${accent}`,
        bgcolor: prompt.is_builtin ? "rgba(25,118,210,0.018)" : "transparent",
        "&:not(:last-child)": { borderBottom: "1px solid rgba(15,23,42,0.055)" },
        "&:hover": { bgcolor: "rgba(15,23,42,0.025)" },
        "&:hover .row-actions": { opacity: 1 },
        cursor: "pointer",
        transition: "background 0.12s",
      }}
    >
      {/* Type label */}
      <Typography sx={{
        fontSize: "0.67rem", fontWeight: 700, color: accent,
        textTransform: "uppercase", letterSpacing: "0.06em",
        pt: 0.4, flexShrink: 0, width: 36,
      }}>
        {isModel ? "Model" : "Judge"}
      </Typography>

      {/* Name + tags + content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5, flexWrap: "nowrap" }}>
          <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", whiteSpace: "nowrap", flexShrink: 0 }}>
            {prompt.name}
          </Typography>
          {tags.map((t, i) => (
            <Chip key={i} label={t.label} size="small" color={t.color} variant="outlined"
              sx={{ fontSize: "0.62rem", height: 18, flexShrink: 0 }} />
          ))}
        </Stack>
        <Typography sx={{
          fontSize: "0.82rem", color: "text.secondary", lineHeight: 1.55,
          display: expanded ? "block" : "-webkit-box",
          WebkitLineClamp: expanded ? "unset" : 2,
          WebkitBoxOrient: "vertical",
          overflow: expanded ? "visible" : "hidden",
          whiteSpace: expanded ? "pre-wrap" : "normal",
          wordBreak: "break-word",
        }}>
          {prompt.content}
        </Typography>
      </Box>

      {/* Actions */}
      <Stack
        direction="row"
        className="row-actions"
        sx={{ opacity: 0, transition: "opacity 0.15s", flexShrink: 0, mt: -0.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton
          size="small"
          onClick={handleCopy}
          title="Copy content"
          sx={{ color: copied ? "success.main" : "rgba(15,23,42,0.45)", "&:hover": { color: copied ? "success.main" : "rgba(15,23,42,0.85)" }, transition: "color 0.15s" }}
        >
          {copied
            ? <DoneOutlinedIcon sx={{ fontSize: 15 }} />
            : <ContentCopyOutlinedIcon sx={{ fontSize: 15 }} />}
        </IconButton>
        {!prompt.is_builtin && (
          <>
            <IconButton size="small" onClick={() => onEdit(prompt)} sx={{ color: "rgba(15,23,42,0.45)", "&:hover": { color: "rgba(15,23,42,0.85)" } }}>
              <EditOutlinedIcon sx={{ fontSize: 15 }} />
            </IconButton>
            <IconButton size="small" onClick={() => onDelete(prompt)} sx={{ color: "rgba(15,23,42,0.45)", "&:hover": { color: "error.main" } }}>
              <DeleteOutlineIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </>
        )}
      </Stack>
    </Box>
  );
}

export default function Prompts() {
  const [prompts, setPrompts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filterType, setFilterType] = React.useState("");
  const [filterSub, setFilterSub] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [deleteTarget, setDeleteTarget] = React.useState(null);

  const load = React.useCallback(() => {
    setLoading(true);
    PromptService.getPrompts()
      .then((res) => setPrompts(res?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const { builtins, userPrompts } = React.useMemo(() => {
    const match = (p) => {
      if (filterType && p.prompt_type !== filterType) return false;
      if (filterSub) {
        if (filterType === "model" && (p.dataset_type ?? "") !== filterSub) return false;
        if (filterType === "judge" && (p.judge_mode ?? "") !== filterSub) return false;
      }
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!p.name.toLowerCase().includes(s) && !p.content.toLowerCase().includes(s)) return false;
      }
      return true;
    };
    const filtered = prompts.filter(match);
    return {
      builtins: filtered.filter((p) => p.is_builtin),
      userPrompts: filtered.filter((p) => !p.is_builtin),
    };
  }, [prompts, filterType, filterSub, search]);

  const handleSave = async (payload) => {
    if (editing) {
      await PromptService.updatePrompt(editing.id, payload);
    } else {
      await PromptService.createPrompt(payload);
    }
    load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await PromptService.deletePrompt(deleteTarget.id);
    setDeleteTarget(null);
    load();
  };

  const onEdit = (p) => { setEditing(p); setDialogOpen(true); };
  const [section, setSection] = React.useState("builtin");

  const activeList = section === "builtin" ? builtins : userPrompts;

  return (
    <Box sx={{
      minHeight: "100vh", height: "100vh",
      px: { xs: 2, md: 4 }, pt: 4, pb: 2,
      display: "flex", flexDirection: "column",
      background: "radial-gradient(circle at top left, rgba(25,118,210,0.1), transparent 30%), radial-gradient(circle at top right, rgba(100,181,246,0.14), transparent 26%), linear-gradient(180deg, #f7fbff 0%, #eef4fb 100%)",
    }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2.5, flexShrink: 0 }}>
        <Stack spacing={0.5}>
          <Typography
            variant="h3"
            sx={{
              fontSize: { xs: "1.9rem", md: "2.5rem" },
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "#0f172a",
              lineHeight: 1.1,
            }}
          >
            Prompt Library
          </Typography>
          <Typography sx={{ color: "text.secondary", fontSize: "0.93rem", maxWidth: 520 }}>
            Browse built-in prompts or manage your own for models and judges.
          </Typography>
        </Stack>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => { setEditing(null); setDialogOpen(true); }}
          sx={{ textTransform: "none", borderRadius: 999, fontWeight: 600, flexShrink: 0, mt: 0.75 }}
        >
          New Prompt
        </Button>
      </Stack>

      {/* Filter bar */}
      <Paper sx={{ borderRadius: 3, border: "1px solid rgba(25,118,210,0.12)", p: 1.5, mb: 2, boxShadow: "0 4px 16px rgba(15,23,42,0.06)", background: "linear-gradient(180deg,rgba(255,255,255,0.97) 0%,rgba(244,248,252,0.98) 100%)", flexShrink: 0 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <TextField
            placeholder="Search by name or content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            sx={{ flex: 2, minWidth: 180 }}
          />
          <FormControl size="small" sx={{ flex: 1, minWidth: 110 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setFilterSub(""); }}
              label="Type"
            >
              {TYPE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          {filterType === "model" && (
            <FormControl size="small" sx={{ flex: 1, minWidth: 180 }}>
              <InputLabel>Dataset type</InputLabel>
              <Select value={filterSub} onChange={(e) => setFilterSub(e.target.value)} label="Dataset type">
                {DATASET_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          {filterType === "judge" && (
            <FormControl size="small" sx={{ flex: 1, minWidth: 130 }}>
              <InputLabel>Judge mode</InputLabel>
              <Select value={filterSub} onChange={(e) => setFilterSub(e.target.value)} label="Judge mode">
                {JUDGE_MODE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </Select>
            </FormControl>
          )}
        </Stack>
      </Paper>

      {/* Split layout */}
      <Box sx={{ display: "flex", gap: 1.5, flex: 1, minHeight: 0 }}>

        {/* Left nav — slim */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, flexShrink: 0 }}>
          {[
            { key: "builtin", label: "Built-in", count: builtins.length },
            { key: "user", label: "Yours", count: userPrompts.length },
          ].map(({ key, label, count }) => {
            const active = section === key;
            return (
              <Box
                key={key}
                onClick={() => setSection(key)}
                sx={{
                  display: "flex", alignItems: "center", gap: 1,
                  px: 1.5, py: 1, borderRadius: 2, cursor: "pointer",
                  bgcolor: active ? "rgba(25,118,210,0.08)" : "transparent",
                  border: active ? "1px solid rgba(25,118,210,0.2)" : "1px solid transparent",
                  "&:hover": { bgcolor: active ? "rgba(25,118,210,0.1)" : "rgba(15,23,42,0.04)" },
                  transition: "all 0.12s", whiteSpace: "nowrap",
                }}
              >
                <Typography sx={{ fontSize: "0.8rem", fontWeight: active ? 700 : 500, color: active ? "#1565c0" : "rgba(15,23,42,0.55)" }}>
                  {label}
                </Typography>
                <Typography sx={{ fontSize: "0.68rem", fontWeight: 700, color: active ? "#1565c0" : "rgba(15,23,42,0.3)", bgcolor: active ? "rgba(25,118,210,0.12)" : "rgba(15,23,42,0.06)", px: 0.6, py: 0.1, borderRadius: 999, lineHeight: 1.6 }}>
                  {loading ? "…" : count}
                </Typography>
              </Box>
            );
          })}
        </Box>

        {/* Right list */}
        {loading ? (
          <Typography sx={{ color: "text.secondary", fontSize: "0.9rem", pt: 1 }}>Loading...</Typography>
        ) : activeList.length === 0 ? (
          <Typography sx={{ color: "text.secondary", fontSize: "0.9rem", pt: 1 }}>
            {section === "user" ? 'No prompts yet. Create one with "+ New Prompt".' : "No results."}
          </Typography>
        ) : (
          <Paper sx={{ flex: 1, borderRadius: 4, border: "1px solid rgba(25,118,210,0.12)", overflow: "hidden", overflowY: "auto", boxShadow: "0 14px 40px rgba(15,23,42,0.07)", background: "linear-gradient(180deg,rgba(255,255,255,0.98) 0%,rgba(244,248,252,0.99) 100%)", minHeight: 0 }}>
            {activeList.map((p) => (
              <PromptRow key={p.id} prompt={p} onEdit={onEdit} onDelete={setDeleteTarget} />
            ))}
          </Paper>
        )}
      </Box>

      <PromptFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        initial={editing}
      />

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} PaperProps={{ sx: { borderRadius: 4, p: 1 } }}>
        <Box sx={{ px: 3, pt: 3, pb: 2 }}>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>Delete prompt?</Typography>
          <Typography sx={{ fontSize: "0.88rem", color: "text.secondary" }}>
            "{deleteTarget?.name}" will be permanently deleted.
          </Typography>
        </Box>
        <Box sx={{ px: 3, pb: 2, display: "flex", justifyContent: "flex-end", gap: 1 }}>
          <Button onClick={() => setDeleteTarget(null)} sx={{ textTransform: "none", color: "text.secondary" }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete} sx={{ textTransform: "none", borderRadius: 999 }}>Delete</Button>
        </Box>
      </Dialog>
    </Box>
  );
}
