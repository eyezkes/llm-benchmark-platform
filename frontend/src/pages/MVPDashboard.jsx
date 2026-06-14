import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import React from "react";
import { Link } from "react-router";
import { LlmContext } from "../context/LlmContext";
import ExperimentService from "../api/services/experiment";
import DatasetService from "../api/services/dataset";

const pageShellSx = {
  minHeight: "100vh",
  px: { xs: 2, md: 4 },
  py: { xs: 3, md: 4 },
  background:
    "radial-gradient(circle at top left, rgba(25,118,210,0.14), transparent 32%), radial-gradient(circle at top right, rgba(100,181,246,0.18), transparent 28%), linear-gradient(180deg, #f7fbff 0%, #eef4fb 100%)",
};

const maxW = { maxWidth: 1180, mx: "auto" };

const sectionCardSx = {
  p: { xs: 2, md: 3 },
  borderRadius: 4,
  border: "1px solid rgba(25,118,210,0.12)",
  boxShadow: "0 14px 35px rgba(15, 23, 42, 0.06)",
};

const STATUS_COLOR = {
  pending: "default",
  running: "info",
  completed: "success",
  failed: "error",
};

const JUDGE_TYPE_LABELS = {
  llm_bool: "LLM Binary",
  llm_score: "LLM Scoring",
  equals: "Exact Match",
  contains: "Contains",
  json_equals: "JSON Match",
  similarity: "Similarity Metrics",
};

const StatCard = ({ label, value, sub, Icon }) => (
  <Paper
    sx={{
      ...sectionCardSx,
      background:
        "linear-gradient(135deg, rgba(25,118,210,0.11) 0%, rgba(144,202,249,0.07) 100%)",
    }}
  >
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      {Icon && <Icon sx={{ fontSize: "2rem", color: "#0f172a" }} />}
      <Typography variant="h3" sx={{ fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
    {sub && (
      <Typography sx={{ color: "text.secondary", mt: 1, fontSize: "0.82rem" }}>{sub}</Typography>
    )}
  </Paper>
);

const CardHeader = ({ title, linkTo, linkLabel }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
    <Typography
      component={Link}
      to={linkTo}
      variant="h5"
      sx={{ fontWeight: 700, color: "inherit", textDecoration: "none", "&:hover": { color: "#1565c0" }, transition: "color 0.15s" }}
    >
      {title}
    </Typography>
    <Button
      component={Link}
      to={linkTo}
      size="small"
      variant="outlined"
      sx={{ textTransform: "none", borderRadius: 999, flexShrink: 0 }}
    >
      {linkLabel}
    </Button>
  </Stack>
);

const cellBg = (g) => {
  if (g == null) return "transparent";
  if (g >= 0.7) return `rgba(46,125,50,${(0.07 + g * 0.18).toFixed(2)})`;
  if (g < 0.4) return `rgba(211,47,47,${(0.07 + (1 - g) * 0.18).toFixed(2)})`;
  return "rgba(255,167,38,0.09)";
};
const cellColor = (g) => {
  if (g == null) return "rgba(15,23,42,0.35)";
  if (g >= 0.7) return "#1b5e20";
  if (g < 0.4) return "#b71c1c";
  return "#bf360c";
};
const rankCol = (data, higherBetter) => {
  const indexed = data.map((v, i) => ({ v, i })).filter(({ v }) => v != null);
  indexed.sort((a, b) => (higherBetter ? a.v - b.v : b.v - a.v));
  const n = indexed.length;
  const ranks = new Array(data.length).fill(null);
  indexed.forEach(({ i }, rank) => {
    ranks[i] = n <= 1 ? 0.5 : rank / (n - 1);
  });
  return ranks;
};

const ExperimentMatrix = ({ experiments, models, datasetMap, judgeModels = {} }) => {
  const completedExps = experiments.filter(
    (e) => e.status === "completed" && e.runs?.some((r) => r.status === "completed")
  );
  const defaultId = completedExps.length > 0 ? completedExps[completedExps.length - 1].id : null;
  const [selectedExpId, setSelectedExpId] = React.useState(null);
  const [selectedJudgeKey, setSelectedJudgeKey] = React.useState(null);

  const effectiveId = selectedExpId ?? defaultId;
  React.useEffect(() => { setSelectedJudgeKey(null); }, [effectiveId]);

  if (completedExps.length === 0) {
    return (
      <Paper sx={{ ...sectionCardSx, minHeight: 140, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Experiment Results</Typography>
        <Typography sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
          No completed experiments yet. Run one to see results here.
        </Typography>
      </Paper>
    );
  }

  const selectedExp = completedExps.find((e) => e.id === effectiveId) ?? completedExps[completedExps.length - 1];
  const valid = selectedExp.runs.filter((r) => r.status === "completed");
  const modelNamesMap = Object.fromEntries(models.map((m) => [m.id, m.name]));
  const modelIds = [...new Set(valid.map((r) => r.model_id))];
  const judgeConfigKey = (jc) => `${jc.judge_type}:${jc.judge_model_id ?? ""}`;
  const uniqueJudgeConfigs = [...new Map(valid.map((r) => [judgeConfigKey(r), { judge_type: r.judge_type, judge_model_id: r.judge_model_id }])).values()];
  const judgeLabel = (jc) => {
    const typeName = JUDGE_TYPE_LABELS[jc.judge_type] ?? jc.judge_type;
    if (!jc.judge_model_id) return typeName;
    return judgeModels[jc.judge_model_id] ? `${typeName} · ${judgeModels[jc.judge_model_id]}` : typeName;
  };
  const effectiveJudge = (selectedJudgeKey && uniqueJudgeConfigs.some((jc) => judgeConfigKey(jc) === selectedJudgeKey))
    ? uniqueJudgeConfigs.find((jc) => judgeConfigKey(jc) === selectedJudgeKey)
    : uniqueJudgeConfigs[0];

  const avgByModel = (getter) =>
    modelIds.map((mid) => {
      const vals = valid.filter((r) => r.model_id === mid).map(getter).filter((v) => v != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

  const accuracyData = modelIds.map((mid) => {
    const run = valid.find((r) => r.model_id === mid && r.judge_type === effectiveJudge.judge_type && r.judge_model_id === effectiveJudge.judge_model_id);
    if (!run) return null;
    const v = run.accuracy ?? run.normalized_average_score;
    return v != null ? parseFloat((v * 100).toFixed(1)) : null;
  });
  const costData = avgByModel((r) => r.estimated_cost_usd).map((v) => (v != null ? parseFloat(v.toFixed(6)) : null));
  const latencyData = avgByModel((r) => r.e2e_response_time_median_ms).map((v) => (v != null ? Math.round(v) : null));
  const tokenData = avgByModel((r) => (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0)).map((v) => (v != null ? Math.round(v) : null));

  const isSimilarity = effectiveJudge.judge_type === "similarity";
  const simMetric = (key) =>
    modelIds.map((mid) => {
      const run = valid.find((r) => r.model_id === mid && r.judge_type === effectiveJudge.judge_type && r.judge_model_id === effectiveJudge.judge_model_id);
      const v = run?.similarity_metrics?.[key];
      return v != null ? parseFloat((v * 100).toFixed(1)) : null;
    });

  const allCols = isSimilarity
    ? [
        { key: "bleu", label: "BLEU", sub: null, data: simMetric("avg_bleu"), higherBetter: true, fmt: (v) => `${v}%` },
        { key: "rouge_l", label: "ROUGE-L", sub: null, data: simMetric("avg_rouge_l"), higherBetter: true, fmt: (v) => `${v}%` },
        { key: "semantic", label: "Semantic", sub: "similarity", data: simMetric("avg_semantic_similarity"), higherBetter: true, fmt: (v) => `${v}%` },
        { key: "cer", label: "CER", sub: "lower=better", data: simMetric("avg_cer"), higherBetter: false, fmt: (v) => `${v}%` },
      ]
    : [
        { key: "accuracy", label: effectiveJudge.judge_type === "llm_score" ? "Score" : "Accuracy", sub: uniqueJudgeConfigs.length === 1 ? judgeLabel(effectiveJudge) : null, data: accuracyData, higherBetter: true, fmt: (v) => `${v}%` },
        { key: "cost", label: "Cost", sub: "USD", data: costData, higherBetter: false, fmt: (v) => v < 0.0001 ? `$${v.toExponential(1)}` : `$${v.toFixed(4)}` },
        { key: "latency", label: "Latency", sub: "ms", data: latencyData, higherBetter: false, fmt: (v) => v.toLocaleString() },
        { key: "tokens", label: "Tokens", sub: null, data: tokenData, higherBetter: false, fmt: (v) => v.toLocaleString() },
      ];
  const columns = allCols.filter((c) => c.data.some((v) => v != null));
  const normalizedData = columns.map((col) => rankCol(col.data, col.higherBetter));

  return (
    <Paper sx={sectionCardSx}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2.5 }} gap={1}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {completedExps.length > 1 ? (
            <Select
              size="small"
              value={effectiveId}
              onChange={(e) => setSelectedExpId(e.target.value)}
              variant="standard"
              sx={{ fontWeight: 800, fontSize: "1.05rem", color: "#0f172a", maxWidth: "100%" }}
            >
              {[...completedExps].reverse().map((exp) => (
                <MenuItem key={exp.id} value={exp.id}>{exp.name}</MenuItem>
              ))}
            </Select>
          ) : (
            <Typography sx={{ fontWeight: 800, fontSize: "1.05rem", color: "#0f172a" }}>
              {selectedExp.name}
            </Typography>
          )}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }} flexWrap="wrap">
            {datasetMap[selectedExp.dataset_id] && (
              <>
                <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>{datasetMap[selectedExp.dataset_id]}</Typography>
                <Typography sx={{ fontSize: "0.78rem", color: "rgba(15,23,42,0.25)" }}>·</Typography>
              </>
            )}
            <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>{selectedExp.sample_size} samples</Typography>
            <Typography sx={{ fontSize: "0.78rem", color: "rgba(15,23,42,0.25)" }}>·</Typography>
            <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>{modelIds.length} model{modelIds.length !== 1 ? "s" : ""}</Typography>
          </Stack>
        </Box>
        <Stack direction="row" alignItems="center" spacing={1} flexShrink={0}>
          {uniqueJudgeConfigs.length > 1 && (
            <Select
              size="small"
              value={judgeConfigKey(effectiveJudge)}
              onChange={(e) => setSelectedJudgeKey(e.target.value)}
              sx={{ fontSize: "0.8rem", minWidth: 140 }}
            >
              {uniqueJudgeConfigs.map((jc) => (
                <MenuItem key={judgeConfigKey(jc)} value={judgeConfigKey(jc)}>{judgeLabel(jc)}</MenuItem>
              ))}
            </Select>
          )}
          <Button component={Link} to={`/experiments/${selectedExp.id}`} size="small" variant="outlined" sx={{ textTransform: "none", borderRadius: 999 }}>
            Open
          </Button>
        </Stack>
      </Stack>

      {/* Matrix */}
      <Box sx={{ overflowX: "auto" }}>
        {/* Column headers */}
        <Box sx={{ display: "flex", pb: 1, mb: 0.5, borderBottom: "2px solid rgba(25,118,210,0.1)" }}>
          <Box sx={{ flex: "0 0 160px" }} />
          {columns.map((col) => (
            <Box key={col.key} sx={{ flex: 1, textAlign: "center", px: 1 }}>
              <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                {col.label}
              </Typography>
              {col.sub && (
                <Typography sx={{ fontSize: "0.65rem", color: "rgba(15,23,42,0.3)", mt: 0.15, lineHeight: 1.2 }}>
                  {col.sub}
                </Typography>
              )}
            </Box>
          ))}
        </Box>

        {/* Data rows */}
        {modelIds.map((mid, ri) => (
          <Box
            key={mid}
            sx={{
              display: "flex",
              alignItems: "center",
              py: 0.625,
              borderBottom: ri < modelIds.length - 1 ? "1px solid rgba(15,23,42,0.05)" : "none",
            }}
          >
            <Box sx={{ flex: "0 0 160px", pr: 1.5 }}>
              {(() => {
                const m = models.find((x) => x.id === mid);
                const name = modelNamesMap[mid] ?? `#${mid}`;
                return (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                    <Typography sx={{ fontSize: "0.875rem", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </Typography>
                    {m && (m.system_prompt || m.base_url || m.model_name) && (
                      <Tooltip placement="right" arrow slotProps={{ tooltip: { sx: { fontSize: "0.78rem", p: 1.25 } } }} title={
                        <Box>
                          {m.model_name && <Typography sx={{ fontSize: "0.75rem", fontWeight: 700 }}>{m.model_name}</Typography>}
                          {m.provider && <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)" }}>Provider: {m.provider}</Typography>}
                          {m.system_prompt && <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)", maxWidth: 260, whiteSpace: "pre-wrap", wordBreak: "break-word", mt: 0.5 }}>Prompt: {m.system_prompt.length > 120 ? m.system_prompt.slice(0, 120) + "…" : m.system_prompt}</Typography>}
                          {m.base_url && <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)", mt: 0.25 }}>URL: {m.base_url}</Typography>}
                        </Box>
                      }>
                        <Box component="span" sx={{ color: "#1565c0", cursor: "help", fontSize: "0.78rem", lineHeight: 1, userSelect: "none", flexShrink: 0 }}>ℹ</Box>
                      </Tooltip>
                    )}
                  </Box>
                );
              })()}
            </Box>
            {columns.map((col, ci) => {
              const val = col.data[ri];
              const g = normalizedData[ci][ri];
              return (
                <Box
                  key={col.key}
                  sx={{
                    flex: 1,
                    mx: 0.5,
                    py: 0.875,
                    px: 1,
                    textAlign: "center",
                    borderRadius: 2,
                    backgroundColor: cellBg(g),
                  }}
                >
                  <Typography sx={{ fontSize: "0.875rem", fontWeight: 700, color: cellColor(g) }}>
                    {val != null ? col.fmt(val) : "—"}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

const PaginatedList = ({ items, pageSize, renderItem, renderPlaceholder, emptyNode }) => {
  const [start, setStart] = React.useState(0);

  React.useEffect(() => { setStart(0); }, [items]);

  const total = items.length;
  const visible = items.slice(start, start + pageSize);
  const placeholderCount = total > 0 ? Math.max(0, pageSize - visible.length) : 0;
  const canPrev = start > 0;
  const canNext = start + pageSize < total;
  const page = Math.floor(start / pageSize) + 1;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <List sx={{ p: 0 }}>
        {total === 0
          ? emptyNode
          : (
            <>
              {visible.map(renderItem)}
              {Array.from({ length: placeholderCount }, (_, i) => (
                <React.Fragment key={`ph-${i}`}>{renderPlaceholder()}</React.Fragment>
              ))}
            </>
          )
        }
      </List>
      {total > pageSize && (
        <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={0.25} sx={{ mt: 0.5 }}>
          <IconButton size="small" onClick={() => setStart((s) => Math.max(s - pageSize, 0))} disabled={!canPrev} sx={{ p: 0.25 }}>
            <KeyboardArrowLeftIcon fontSize="small" />
          </IconButton>
          <Typography sx={{ fontSize: "0.72rem", color: "text.secondary", userSelect: "none", minWidth: 32, textAlign: "center" }}>
            {page} / {totalPages}
          </Typography>
          <IconButton size="small" onClick={() => setStart((s) => s + pageSize)} disabled={!canNext} sx={{ p: 0.25 }}>
            <KeyboardArrowRightIcon fontSize="small" />
          </IconButton>
        </Stack>
      )}
    </>
  );
};

const InfoRow = ({ label, value }) =>
  value != null && value !== "" ? (
    <Box sx={{ display: "flex", gap: 2, py: 0.6 }}>
      <Typography sx={{ fontSize: "0.875rem", fontWeight: 700, color: "text.secondary", minWidth: 140, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: "0.875rem", color: "#0f172a", wordBreak: "break-all" }}>
        {String(value)}
      </Typography>
    </Box>
  ) : null;

const dialogPaperSx = {
  borderRadius: 5,
  overflow: "hidden",
  border: "1px solid rgba(25,118,210,0.15)",
  boxShadow: "0 24px 60px rgba(15,23,42,0.14)",
};
const sectionLabelSx = { fontSize: "0.72rem", fontWeight: 700, color: "#1565c0", textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 };

const DialogHeader = ({ title, subtitle, onClose }) => (
  <Box sx={{ px: 3, pt: 3, pb: 2.5, background: "linear-gradient(135deg, rgba(25,118,210,0.1) 0%, rgba(144,202,249,0.07) 100%)", borderBottom: "1px solid rgba(25,118,210,0.1)" }}>
    <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: "1.2rem", color: "#0f172a", lineHeight: 1.2 }}>{title}</Typography>
        {subtitle && <Typography sx={{ fontSize: "0.8rem", color: "#1565c0", mt: 0.5, fontWeight: 500 }}>{subtitle}</Typography>}
      </Box>
      <IconButton onClick={onClose} size="small" sx={{ color: "text.secondary", flexShrink: 0 }}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  </Box>
);

const ModelInfoDialog = ({ model, onClose }) => (
  <Dialog open={!!model} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: dialogPaperSx }}>
    <DialogHeader
      title={model?.name}
      subtitle={[model?.provider, model?.model_name].filter(Boolean).join(" · ")}
      onClose={onClose}
    />
    <DialogContent sx={{ pt: 2.5, pb: 3 }}>
      {model?.base_url && <InfoRow label="Base URL" value={model.base_url} />}
      {model?.system_prompt && <InfoRow label="System Prompt" value={model.system_prompt} />}
      {model?.params && Object.keys(model.params).length > 0 && (
        <>
          <Divider sx={{ my: 2, borderColor: "rgba(25,118,210,0.1)" }} />
          <Typography sx={sectionLabelSx}>Parameters</Typography>
          {Object.entries(model.params).map(([k, v]) => (
            <InfoRow key={k} label={k} value={v} />
          ))}
        </>
      )}
    </DialogContent>
  </Dialog>
);


const Dashboard = () => {
  const { llms } = React.useContext(LlmContext);
  const models = llms?.models ?? [];
  const judges = llms?.judges ?? [];
  const [experiments, setExperiments] = React.useState([]);
  const [datasetMap, setDatasetMap] = React.useState({});
  const [datasets, setDatasets] = React.useState([]);
  const [selectedModel, setSelectedModel] = React.useState(null);

  React.useEffect(() => {
    ExperimentService.getExperiments()
      .then((res) => setExperiments(res?.data ?? []))
      .catch(() => {});
    DatasetService.getDatasets()
      .then((res) => {
        const map = {};
        for (const d of res?.data ?? []) map[d.id] = d.name;
        setDatasetMap(map);
        setDatasets(res?.data ?? []);
      })
      .catch(() => {});
  }, []);

  const completed = experiments.filter((e) => e.status === "completed").length;
  const running = experiments.filter((e) => e.status === "running").length;
  const failed = experiments.filter((e) => e.status === "failed").length;
  const readyDatasets = datasets.filter((d) => d.status === "ready").length;

  const expParts = [];
  if (running > 0) expParts.push(`${running} running`);
  if (failed > 0) expParts.push(`${failed} failed`);
  const expSub =
    experiments.length === 0
      ? "No experiments yet"
      : `experiments completed${expParts.length ? ` · ${expParts.join(", ")}` : ""}`;

  return (
    <Box sx={pageShellSx}>
      {/* Page header */}
      <Box sx={{ ...maxW, mb: 3 }}>
        <Typography
          variant="h5"
          sx={{ fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", mb: 0.5 }}
        >
          Your LLM lab.
        </Typography>
        <Typography sx={{ color: "text.secondary", fontSize: "0.95rem" }}>
          Run benchmarks, compare models, make better decisions.
        </Typography>
      </Box>

      {/* Stat row */}
      <Box
        sx={{
          ...maxW,
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, minmax(0, 1fr))" },
          gap: 2,
          mb: 3,
        }}
      >
        <StatCard Icon={ScienceOutlinedIcon} label="Experiments Completed" value={completed} sub={expSub} />
        <StatCard
          Icon={MemoryOutlinedIcon}
          label="Models"
          value={models.length}
          sub={models.length === 0 ? "No models saved" : "models saved"}
        />
        <StatCard
          Icon={GavelOutlinedIcon}
          label="Judge Models"
          value={judges.length}
          sub={judges.length === 0 ? "No judge models" : "judge models saved"}
        />
        <StatCard
          Icon={StorageOutlinedIcon}
          label="Datasets Ready"
          value={readyDatasets}
          sub={datasets.length === 0 ? "No datasets yet" : `datasets ready${datasets.length - readyDatasets > 0 ? ` · ${datasets.length - readyDatasets} pending` : ""}`}
        />
      </Box>

      {/* Experiment matrix — full width */}
      <Box sx={{ ...maxW, mb: 3 }}>
        <ExperimentMatrix experiments={experiments} models={models} datasetMap={datasetMap} judgeModels={Object.fromEntries(judges.map((j) => [j.id, j.name]))} />
      </Box>

      {/* Bottom row: Models | Experiments */}
      <Box
        sx={{
          ...maxW,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "repeat(2, minmax(0, 1fr))" },
          gap: 3,
        }}
      >
        <Paper sx={sectionCardSx}>
          <CardHeader title="Models" linkTo="/models" linkLabel="Add model" />
          <PaginatedList
            items={models}
            pageSize={5}
            emptyNode={
              <ListItem sx={{ px: 0 }}>
                <ListItemText
                  primary="No saved models"
                  secondary={<Link to="/models" style={{ color: "#1565c0" }}>Add one on the Models page</Link>}
                />
              </ListItem>
            }
            renderPlaceholder={() => (
              <ListItem sx={{ px: 0, py: 1, visibility: "hidden", borderBottom: "1px solid transparent" }}>
                <ListItemText primary="x" secondary="x" />
              </ListItem>
            )}
            renderItem={(item, i) => (
              <ListItem
                key={item.id ?? `${item.name}-${i}`}
                onClick={() => setSelectedModel(item)}
                sx={{
                  px: 0, py: 1,
                  borderBottom: "1px solid rgba(15,23,42,0.06)",
                  color: "inherit",
                  cursor: "pointer",
                  "&:hover .MuiListItemText-primary": { color: "#1565c0" },
                }}
              >
                <ListItemText
                  primary={item.name}
                  secondary={[item.provider, item.model_name].filter(Boolean).join(" · ")}
                />
              </ListItem>
            )}
          />
        </Paper>

        <Paper sx={sectionCardSx}>
          <CardHeader title="Experiments" linkTo="/experiments" linkLabel="New experiment" />
          <PaginatedList
            items={[...experiments].sort((a, b) => {
              const order = { running: 0, failed: 1, completed: 2, pending: 3 };
              const oa = order[a.status] ?? 4;
              const ob = order[b.status] ?? 4;
              if (oa !== ob) return oa - ob;
              return new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0);
            })}
            pageSize={5}
            emptyNode={
              <ListItem sx={{ px: 0 }}>
                <ListItemText primary="No experiments yet" secondary="Create one from the Experiments tab." />
              </ListItem>
            }
            renderPlaceholder={() => (
              <ListItem sx={{ px: 0, py: 1.25, visibility: "hidden", borderBottom: "1px solid transparent" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: "0.9rem" }}>x</Typography>
                  <Chip label="x" size="small" sx={{ mt: 0.5, fontSize: "0.72rem", borderRadius: 999, fontWeight: 700 }} />
                </Box>
              </ListItem>
            )}
            renderItem={(item) => (
              <ListItem
                key={item.id}
                component={Link}
                to={`/experiments/${item.id}`}
                sx={{
                  px: 0, py: 1.25,
                  borderBottom: "1px solid rgba(15,23,42,0.06)",
                  textDecoration: "none",
                  color: "inherit",
                  borderRadius: 1,
                  "&:hover": { backgroundColor: "rgba(25,118,210,0.04)", pl: 0.5 },
                  transition: "background-color 0.15s, padding-left 0.15s",
                  cursor: "pointer",
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name ?? item.id}
                    </Typography>
                    {item.description && (
                      <Tooltip
                        title={item.description}
                        placement="top"
                        arrow
                        slotProps={{ tooltip: { sx: { fontSize: "0.82rem", maxWidth: 280, lineHeight: 1.5, p: 1.25 } } }}
                      >
                        <Box component="span" sx={{ color: "#1565c0", cursor: "help", fontSize: "0.85rem", lineHeight: 1, userSelect: "none", flexShrink: 0 }}>
                          ℹ
                        </Box>
                      </Tooltip>
                    )}
                  </Box>
                  <Chip
                    label={item.status ?? "unknown"}
                    color={STATUS_COLOR[item.status] ?? "default"}
                    size="small"
                    sx={{ mt: 0.5, fontSize: "0.72rem", borderRadius: 999, fontWeight: 700 }}
                  />
                </Box>
              </ListItem>
            )}
          />
        </Paper>
      </Box>

      <ModelInfoDialog model={selectedModel} onClose={() => setSelectedModel(null)} />
    </Box>
  );
};

export default Dashboard;
