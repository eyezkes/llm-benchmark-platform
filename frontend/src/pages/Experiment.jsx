import React from "react";
import { useNavigate, useParams } from "react-router";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import ErrorSnackbar from "../components/ErrorSnackbar";
import { BarChart } from "@mui/x-charts/BarChart";
import { ScatterChart } from "@mui/x-charts/ScatterChart";
import ExperimentService from "../api/services/experiment";
import ModelService from "../api/services/model";
import DatasetService from "../api/services/dataset";
import { getToken } from "../api/auth";

const BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

const pageShellSx = {
  minHeight: "100vh",
  px: { xs: 2, md: 4 },
  py: { xs: 3, md: 5 },
  background:
    "radial-gradient(circle at top left, rgba(25,118,210,0.14), transparent 32%), radial-gradient(circle at top right, rgba(100,181,246,0.18), transparent 28%), linear-gradient(180deg, #f7fbff 0%, #eef4fb 100%)",
};

const cardSx = {
  p: { xs: 2, md: 3 },
  borderRadius: 4,
  border: "1px solid rgba(25,118,210,0.12)",
  boxShadow: "0 14px 35px rgba(15,23,42,0.06)",
};

const STATUS_COLOR = {
  pending: "default",
  running: "info",
  completed: "success",
  failed: "error",
  cancelled: "warning",
};

const SCORE_JUDGES = ["llm_score"];
const BOOL_JUDGES = ["llm_bool", "equals", "contains", "json_equals"];
const SIMILARITY_JUDGES = ["similarity"];

const JUDGE_TYPE_LABELS = {
  llm_bool: "LLM Binary",
  llm_score: "LLM Scoring",
  equals: "Exact Match",
  contains: "Contains",
  json_equals: "JSON Match",
  similarity: "Similarity Metrics",
};

const formatCost = (usd) => {
  if (usd == null || usd === 0) return "—";
  if (usd < 0.0001) return `$${usd.toExponential(2)}`;
  return `$${usd.toFixed(6)}`;
};

const Metric = ({ label, value }) => (
  <Stack spacing={0.25}>
    <Typography sx={{ fontSize: "0.7rem", color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
      {label}
    </Typography>
    <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", color: "#0f172a" }}>
      {value ?? "—"}
    </Typography>
  </Stack>
);

const MetricGrid = ({ children }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 2 }}>
    {children}
  </Box>
);

// Primary score badge shown in run header
const ScoreBadge = ({ run }) => {
  let value = null;
  let label = "";

  if (BOOL_JUDGES.includes(run.judge_type) && run.accuracy != null) {
    value = run.accuracy;
    label = `${(run.accuracy * 100).toFixed(1)}% accuracy`;
  } else if (SCORE_JUDGES.includes(run.judge_type) && run.normalized_average_score != null) {
    value = run.normalized_average_score;
    label = `${(run.normalized_average_score * 100).toFixed(1)}% score`;
  }

  if (value == null || run.status !== "completed") return null;

  const color = value >= 0.7 ? "#2e7d32" : value >= 0.4 ? "#e65100" : "#c62828";
  const bg = value >= 0.7 ? "rgba(46,125,50,0.1)" : value >= 0.4 ? "rgba(230,81,0,0.1)" : "rgba(198,40,40,0.1)";

  return (
    <Box sx={{ px: 1.5, py: 0.5, borderRadius: 2, background: bg, border: `1px solid ${color}30` }}>
      <Typography sx={{ fontWeight: 800, fontSize: "0.9rem", color }}>{label}</Typography>
    </Box>
  );
};

const CategoryBreakdown = ({ categoryMetrics, isScore, isSimilarity }) => {
  const entries = Object.entries(categoryMetrics);
  if (entries.length === 0) return null;

  return (
    <Stack spacing={1.5}>
      <Typography sx={{ fontWeight: 700, fontSize: "0.8rem", color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Category Breakdown
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1.5 }}>
        {entries.map(([cat, val]) => (
          <Box key={cat} sx={{ px: 2, py: 1.5, borderRadius: 2.5, background: "rgba(25,118,210,0.04)", border: "1px solid rgba(25,118,210,0.1)" }}>
            <Typography sx={{ fontWeight: 700, fontSize: "0.85rem", mb: 0.75, color: "#0f172a" }}>
              {cat}
            </Typography>
            <Stack spacing={0.4}>
              {isSimilarity ? (
                <>
                  {Object.entries(SIM_METRIC_LABELS).map(([key, label]) =>
                    val[key] != null ? (
                      <Typography key={key} sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
                        {label}: <strong>{SIM_METRIC_FORMAT[key](val[key])}</strong>
                      </Typography>
                    ) : null
                  )}
                </>
              ) : isScore ? (
                <>
                  {val.average_score != null && (
                    <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
                      Avg score: <strong>{val.average_score.toFixed(3)}</strong>
                    </Typography>
                  )}
                </>
              ) : (
                <>
                  {val.accuracy != null && (
                    <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
                      Accuracy: <strong>{(val.accuracy * 100).toFixed(1)}%</strong>
                    </Typography>
                  )}
                  {val.correct != null && (
                    <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
                      Correct: <strong>{val.correct} / {val.evaluated}</strong>
                    </Typography>
                  )}
                </>
              )}
              <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
                Samples: <strong>{val.count}</strong>
              </Typography>
              {val.invalid > 0 && (
                <Typography sx={{ fontSize: "0.78rem", color: "#e53935" }}>
                  Invalid: <strong>{val.invalid}</strong>
                </Typography>
              )}
            </Stack>
          </Box>
        ))}
      </Box>
    </Stack>
  );
};

const SIM_METRIC_LABELS = {
  avg_bleu: "BLEU",
  avg_rouge_l: "ROUGE-L",
  avg_cer: "CER",
  avg_semantic_similarity: "Semantic Sim.",
  avg_perplexity: "Perplexity",
};

const SIM_METRIC_FORMAT = {
  avg_bleu: (v) => v.toFixed(4),
  avg_rouge_l: (v) => v.toFixed(4),
  avg_cer: (v) => v.toFixed(4),
  avg_semantic_similarity: (v) => v.toFixed(4),
  avg_perplexity: (v) => v.toFixed(2),
};

const SimilarityPanel = ({ similarityMetrics }) => {
  if (!similarityMetrics) return null;
  const keys = Object.keys(SIM_METRIC_LABELS);
  return (
    <Stack spacing={1.5}>
      <Typography sx={{ fontWeight: 700, fontSize: "0.8rem", color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Similarity Metrics
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 1.5 }}>
        {keys.map((key) => {
          const val = similarityMetrics[key];
          return (
            <Box key={key} sx={{ px: 2, py: 1.5, borderRadius: 2.5, background: "rgba(0,137,123,0.05)", border: "1px solid rgba(0,137,123,0.15)" }}>
              <Typography sx={{ fontSize: "0.7rem", fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }}>
                {SIM_METRIC_LABELS[key]}
              </Typography>
              <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", color: "#004d40" }}>
                {val != null ? SIM_METRIC_FORMAT[key](val) : "—"}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Stack>
  );
};

const renderInline = (text) =>
  text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );

const SimpleMarkdown = ({ text }) => (
  <Stack spacing={0.5}>
    {text.split("\n").map((line, i) => {
      if (line.startsWith("### "))
        return (
          <Typography key={i} sx={{ fontWeight: 700, fontSize: "0.92rem", color: "#1565c0", mt: 1.5, letterSpacing: "-0.01em" }}>
            {line.slice(4)}
          </Typography>
        );
      if (line.startsWith("## "))
        return (
          <Typography key={i} sx={{ fontWeight: 800, fontSize: "1rem", color: "#0f172a", mt: 2 }}>
            {line.slice(3)}
          </Typography>
        );
      if (line.startsWith("- ") || /^\d+\. /.test(line)) {
        const content = line.startsWith("- ") ? line.slice(2) : line.replace(/^\d+\. /, "");
        return (
          <Stack key={i} direction="row" spacing={1} sx={{ pl: 1.5 }}>
            <Typography sx={{ color: "text.secondary", lineHeight: "1.65", flexShrink: 0 }}>•</Typography>
            <Typography sx={{ fontSize: "0.875rem", color: "#1e293b", lineHeight: "1.65" }}>{renderInline(content)}</Typography>
          </Stack>
        );
      }
      if (line.trim() === "") return <Box key={i} sx={{ height: 3 }} />;
      return (
        <Typography key={i} sx={{ fontSize: "0.875rem", color: "#1e293b", lineHeight: "1.65" }}>
          {renderInline(line)}
        </Typography>
      );
    })}
  </Stack>
);

const AnalysisPanel = ({ experiment, modelNames, modelBaseNames }) => {
  const completedModelIds = React.useMemo(
    () =>
      (experiment.candidate_model_ids ?? []).filter((mid) =>
        (experiment.runs ?? []).some((r) => r.model_id === mid && r.status === "completed")
      ),
    [experiment]
  );

  const [selectedModelId, setSelectedModelId] = React.useState(null);
  const [analysis, setAnalysis] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [analyzeError, setAnalyzeError] = React.useState(null);

  React.useEffect(() => {
    if (completedModelIds.length > 0 && selectedModelId === null) {
      setSelectedModelId(completedModelIds[0]);
    }
  }, [completedModelIds, selectedModelId]);

  if (experiment.status !== "completed" || completedModelIds.length === 0) return null;

  const handleAnalyze = async () => {
    if (!selectedModelId) return;
    setLoading(true);
    setAnalyzeError(null);
    setAnalysis(null);
    try {
      const res = await ExperimentService.analyzeExperiment(experiment.id, selectedModelId);
      setAnalysis(res?.data?.analysis ?? null);
    } catch {
      setAnalyzeError("Analysis failed. Check the model's API key and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper sx={cardSx}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1.5}>
          <Stack spacing={0.25}>
            <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", color: "#0f172a" }}>AI Analysis</Typography>
            <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
              Interpreted by one of your tested models — no extra setup needed
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Select
              size="small"
              value={selectedModelId ?? ""}
              onChange={(e) => setSelectedModelId(e.target.value)}
              sx={{ minWidth: 180, fontSize: "0.875rem" }}
            >
              {completedModelIds.map((mid) => (
                <MenuItem key={mid} value={mid}>{modelBaseNames[mid] ?? modelNames[mid] ?? `Model #${mid}`}</MenuItem>
              ))}
            </Select>
            <Button
              variant="contained"
              size="small"
              disabled={loading || !selectedModelId}
              onClick={handleAnalyze}
              sx={{ textTransform: "none", borderRadius: 999, minWidth: 90 }}
            >
              {loading ? <CircularProgress size={14} sx={{ mr: 1, color: "inherit" }} /> : null}
              {loading ? "Analyzing…" : "Analyze"}
            </Button>
          </Stack>
        </Stack>

        {analyzeError && (
          <Typography color="error" sx={{ fontSize: "0.875rem" }}>{analyzeError}</Typography>
        )}

        {loading && !analysis && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {analysis && !loading && (
          <>
            <Divider sx={{ borderColor: "rgba(25,118,210,0.1)" }} />
            <SimpleMarkdown text={analysis} />
          </>
        )}
      </Stack>
    </Paper>
  );
};

const ModelInfoTooltip = ({ model }) => {
  if (!model) return null;
  return (
    <Tooltip
      placement="top"
      arrow
      title={
        <Stack spacing={0.4} sx={{ p: 0.5 }}>
          <Typography sx={{ fontSize: "0.75rem", fontWeight: 700 }}>{model.model_name}</Typography>
          <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)" }}>Provider: {model.provider}</Typography>
          {model.system_prompt && (
            <Typography sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)", maxWidth: 260, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              Prompt: {model.system_prompt.length > 120 ? model.system_prompt.slice(0, 120) + "…" : model.system_prompt}
            </Typography>
          )}
        </Stack>
      }
    >
      <Box component="span" sx={{ color: "text.disabled", cursor: "help", fontSize: "0.8rem", ml: 0.5, userSelect: "none", lineHeight: 1 }}>ℹ</Box>
    </Tooltip>
  );
};

const toSafeFilename = (str) => str.replace(/[^a-zA-Z0-9._-]/g, "_");

const downloadFile = async (url, filename) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return;
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

const RunCard = ({ run, experimentId, modelNames, modelDetails, judgeNames, onCancelRun }) => {
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState("");

  const handleCancel = async () => {
    setCancelling(true);
    setCancelError("");
    try {
      await ExperimentService.cancelRun(experimentId, run.id);
      onCancelRun?.();
    } catch {
      setCancelError("Failed to cancel run.");
    } finally {
      setCancelling(false);
    }
  };

  const isCompleted = run.status === "completed";
  const isScore = SCORE_JUDGES.includes(run.judge_type);
  const isSimilarity = SIMILARITY_JUDGES.includes(run.judge_type);
  const hasLatency = run.e2e_response_time_ms != null || run.e2e_response_time_median_ms != null || run.latency_ttft_ms != null;
  const hasTokens = run.total_tokens != null || run.estimated_cost_usd != null;
  const hasCategoryMetrics = run.category_metrics && Object.keys(run.category_metrics).length > 0;
  const hasSimilarityMetrics = isSimilarity && run.similarity_metrics != null;
  const modelName = modelNames[run.model_id] ?? `Model #${run.model_id}`;
  const judgeName = judgeNames[run.judge_model_id] ?? (run.judge_model_id ? `Judge #${run.judge_model_id}` : null);

  return (
    <Paper sx={cardSx}>
      {/* Run header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography sx={{ fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>
                {modelName}
              </Typography>
              <ModelInfoTooltip model={modelDetails?.[run.model_id]} />
            </Box>
            <ScoreBadge run={run} />
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip label={JUDGE_TYPE_LABELS[run.judge_type] ?? run.judge_type} size="small" color="primary" variant="outlined" />
            {judgeName && <Chip label={judgeName} size="small" variant="outlined" />}
          </Stack>
        </Stack>
        <Chip label={run.status} color={STATUS_COLOR[run.status] ?? "default"} size="small" sx={{ fontWeight: 700 }} />
      </Stack>

      {run.status === "running" && (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CircularProgress size={16} />
            <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>Run in progress…</Typography>
            <Button
              size="small"
              color="error"
              variant="outlined"
              disabled={cancelling}
              onClick={handleCancel}
              sx={{ textTransform: "none", borderRadius: 999, ml: 1 }}
            >
              {cancelling ? <CircularProgress size={12} sx={{ mr: 0.5, color: "inherit" }} /> : null}
              Cancel
            </Button>
          </Stack>
          {cancelError && (
            <Typography color="error" sx={{ fontSize: "0.8rem" }}>{cancelError}</Typography>
          )}
        </Stack>
      )}
      {run.status === "pending" && (
        <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>Waiting to start…</Typography>
      )}
      {run.status === "failed" && (
        <Typography color="error" sx={{ fontSize: "0.9rem" }}>
          Run failed{run.error_message ? `: ${run.error_message}` : "."}
        </Typography>
      )}

      {isCompleted && (
        <Stack spacing={2.5}>
          {/* Quality metrics */}
          <MetricGrid>
            {run.accuracy != null && <Metric label="Accuracy" value={`${(run.accuracy * 100).toFixed(1)}%`} />}
            {run.average_score != null && <Metric label="Avg Score" value={run.average_score.toFixed(3)} />}
            {run.normalized_average_score != null && <Metric label="Norm Score" value={`${(run.normalized_average_score * 100).toFixed(1)}%`} />}
            {run.correct_count != null && <Metric label="Correct" value={run.correct_count} />}
            {run.evaluated_count != null && <Metric label="Evaluated" value={run.evaluated_count} />}
            {run.invalid_count != null && <Metric label="Invalid" value={run.invalid_count} />}
          </MetricGrid>

          {/* Similarity metrics */}
          {hasSimilarityMetrics && (
            <>
              <Divider sx={{ borderColor: "rgba(0,137,123,0.1)" }} />
              <SimilarityPanel similarityMetrics={run.similarity_metrics} />
            </>
          )}

          {/* Latency */}
          {hasLatency && (
            <>
              <Divider sx={{ borderColor: "rgba(25,118,210,0.08)" }} />
              <MetricGrid>
                {run.e2e_response_time_ms != null && <Metric label="E2E Mean" value={`${run.e2e_response_time_ms.toFixed(0)} ms`} />}
                {run.e2e_response_time_median_ms != null && <Metric label="E2E Median" value={`${run.e2e_response_time_median_ms.toFixed(0)} ms`} />}
                {run.e2e_response_time_p95_ms != null && <Metric label="E2E P95" value={`${run.e2e_response_time_p95_ms.toFixed(0)} ms`} />}
                {run.latency_ttft_ms != null && <Metric label="TTFT Mean" value={`${run.latency_ttft_ms.toFixed(0)} ms`} />}
                {run.latency_ttft_median_ms != null && <Metric label="TTFT Median" value={`${run.latency_ttft_median_ms.toFixed(0)} ms`} />}
                {run.latency_ttft_p95_ms != null && <Metric label="TTFT P95" value={`${run.latency_ttft_p95_ms.toFixed(0)} ms`} />}
              </MetricGrid>
            </>
          )}

          {/* Tokens & cost */}
          {hasTokens && (
            <>
              <Divider sx={{ borderColor: "rgba(25,118,210,0.08)" }} />
              <MetricGrid>
                {run.prompt_tokens != null && <Metric label="Prompt Tokens" value={run.prompt_tokens.toLocaleString()} />}
                {run.completion_tokens != null && <Metric label="Completion Tokens" value={run.completion_tokens.toLocaleString()} />}
                {run.total_tokens != null && <Metric label="Total Tokens" value={run.total_tokens.toLocaleString()} />}
                <Metric label="Est. Cost" value={formatCost(run.estimated_cost_usd)} />
              </MetricGrid>
            </>
          )}

          {/* Category breakdown */}
          {hasCategoryMetrics && (
            <>
              <Divider sx={{ borderColor: "rgba(25,118,210,0.08)" }} />
              <CategoryBreakdown categoryMetrics={run.category_metrics} isScore={isScore} isSimilarity={isSimilarity} />
            </>
          )}

          {/* Downloads */}
          {(run.answers_path || run.metrics_path) && (
            <>
              <Divider sx={{ borderColor: "rgba(25,118,210,0.08)" }} />
              <Stack direction="row" spacing={1.5} flexWrap="wrap">
                {run.answers_path && (
                  <Button size="small" variant="outlined" sx={{ textTransform: "none", borderRadius: 999 }}
                    onClick={() => downloadFile(`${BASE}/experiments/${experimentId}/runs/${run.id}/answers`, `${toSafeFilename(modelName)}_${toSafeFilename(judgeName ?? run.judge_type)}_output.csv`)}>
                    Download Output CSV
                  </Button>
                )}
                {run.metrics_path && (
                  <Button size="small" variant="outlined" sx={{ textTransform: "none", borderRadius: 999 }}
                    onClick={() => downloadFile(`${BASE}/experiments/${experimentId}/runs/${run.id}/metrics`, `${toSafeFilename(modelName)}_${toSafeFilename(judgeName ?? run.judge_type)}_summary.json`)}>
                    Download Summary JSON
                  </Button>
                )}
              </Stack>
            </>
          )}
        </Stack>
      )}
    </Paper>
  );
};

const RunsChart = ({ runs, modelNames }) => {
  const [tab, setTab] = React.useState(0);

  const valid = runs.filter((r) => r.status === "completed");
  if (valid.length === 0) return null;

  const modelIds = [...new Set(valid.map((r) => r.model_id))];
  const modelLabels = modelIds.map((mid) => modelNames[mid] ?? `#${mid}`);
  const judgeTypes = [...new Set(valid.map((r) => r.judge_type))];

  const avgByModel = (getter) =>
    modelIds.map((mid) => {
      const vals = valid.filter((r) => r.model_id === mid).map(getter).filter((v) => v != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

  const valueByModelAndJudge = (judgeType, getter) =>
    modelIds.map((mid) => {
      const run = valid.find((r) => r.model_id === mid && r.judge_type === judgeType);
      return run ? getter(run) : null;
    });

  const JUDGE_COLORS = ["#1565c0", "#00897b", "#e65100", "#7b1fa2", "#c62828"];

  const allCharts = [
    // Accuracy / Score — x: models, series: one per judge type
    (() => {
      const series = judgeTypes
        .map((jt, idx) => {
          const data = valueByModelAndJudge(jt, (r) => {
            const v = r.accuracy ?? r.normalized_average_score;
            return v != null ? parseFloat((v * 100).toFixed(1)) : null;
          });
          return data.some((v) => v != null)
            ? { data, label: JUDGE_TYPE_LABELS[jt] ?? jt, color: JUDGE_COLORS[idx % JUDGE_COLORS.length] }
            : null;
        })
        .filter(Boolean);
      return { label: "Accuracy / Score", hasData: series.length > 0, labels: modelLabels, series, yLabel: "%", min: 0, max: 100 };
    })(),

    // Similarity — x: models, series: metrics averaged per model
    (() => {
      const avgSim = (key) =>
        modelIds.map((mid) => {
          const vals = valid.filter((r) => r.model_id === mid && r.similarity_metrics?.[key] != null).map((r) => r.similarity_metrics[key]);
          return vals.length > 0 ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4)) : null;
        });
      const bleu = avgSim("avg_bleu");
      const rouge = avgSim("avg_rouge_l");
      const semSim = avgSim("avg_semantic_similarity");
      const series = [
        ...(bleu.some((v) => v != null) ? [{ data: bleu, label: "BLEU", color: "#1565c0" }] : []),
        ...(rouge.some((v) => v != null) ? [{ data: rouge, label: "ROUGE-L", color: "#00897b" }] : []),
        ...(semSim.some((v) => v != null) ? [{ data: semSim, label: "Semantic Sim.", color: "#6a1b9a" }] : []),
      ];
      return { label: "Similarity", hasData: series.length > 0, labels: modelLabels, series, yLabel: "score", min: 0, max: 1 };
    })(),

    // Latency
    (() => {
      const e2eMedian = avgByModel((r) => r.e2e_response_time_median_ms ?? null);
      const ttftMedian = avgByModel((r) => r.latency_ttft_median_ms ?? null);
      const e2eP95 = avgByModel((r) => r.e2e_response_time_p95_ms ?? null);
      const hasE2E = e2eMedian.some((v) => v != null);
      const hasTTFT = ttftMedian.some((v) => v != null);
      const hasP95 = e2eP95.some((v) => v != null);
      const series = [
        ...(hasE2E ? [{ data: e2eMedian.map((v) => v != null ? parseFloat(v.toFixed(0)) : null), label: "E2E Median", color: "#1565c0" }] : []),
        ...(hasTTFT ? [{ data: ttftMedian.map((v) => v != null ? parseFloat(v.toFixed(0)) : null), label: "TTFT Median", color: "#00897b" }] : []),
        ...(hasP95 ? [{ data: e2eP95.map((v) => v != null ? parseFloat(v.toFixed(0)) : null), label: "E2E P95", color: "#e65100" }] : []),
      ];
      return { label: "Latency (ms)", hasData: hasE2E || hasTTFT || hasP95, labels: modelLabels, series, yLabel: "ms", min: 0, max: undefined };
    })(),

    // Cost
    (() => {
      const costData = avgByModel((r) => r.estimated_cost_usd ?? null).map(
        (v) => v != null ? parseFloat(v.toFixed(6)) : null
      );
      return {
        label: "Cost (USD)",
        hasData: costData.some((v) => v != null && v > 0),
        labels: modelLabels,
        series: [{ data: costData, label: "Est. Cost (USD)", color: "#7b1fa2" }],
        yLabel: "USD",
        min: 0,
        max: undefined,
      };
    })(),

    // Token Count
    (() => {
      const promptData = avgByModel((r) => r.prompt_tokens ?? null).map(
        (v) => v != null ? Math.round(v) : null
      );
      const completionData = avgByModel((r) => r.completion_tokens ?? null).map(
        (v) => v != null ? Math.round(v) : null
      );
      const hasPrompt = promptData.some((v) => v != null);
      const hasCompletion = completionData.some((v) => v != null);
      const series = [
        ...(hasPrompt ? [{ data: promptData, label: "Prompt Tokens", color: "#1565c0", stack: "tokens" }] : []),
        ...(hasCompletion ? [{ data: completionData, label: "Completion Tokens", color: "#00897b", stack: "tokens" }] : []),
      ];
      return { label: "Token Count", hasData: hasPrompt || hasCompletion, labels: modelLabels, series, yLabel: "tokens", min: 0, max: undefined };
    })(),

    // Cost Efficiency — accuracy % per USD
    (() => {
      const effData = modelIds.map((mid) => {
        const runs = valid.filter((r) => r.model_id === mid);
        const accVals = runs.map((r) => r.accuracy ?? r.normalized_average_score).filter((v) => v != null);
        const costVals = runs.map((r) => r.estimated_cost_usd).filter((v) => v != null && v > 0);
        if (accVals.length === 0 || costVals.length === 0) return null;
        const avgAcc = accVals.reduce((a, b) => a + b, 0) / accVals.length;
        const avgCost = costVals.reduce((a, b) => a + b, 0) / costVals.length;
        return parseFloat(((avgAcc * 100) / avgCost).toFixed(2));
      });
      return {
        label: "Cost Efficiency",
        hasData: effData.some((v) => v != null && v > 0),
        labels: modelLabels,
        series: [{ data: effData, label: "Accuracy % per USD", color: "#e65100" }],
        yLabel: "%/USD",
        min: 0,
        max: undefined,
      };
    })(),

    // Accuracy vs Cost & Latency — side-by-side scatter plots
    (() => {
      const mkSeries = (xPicker) =>
        modelIds.map((mid, idx) => {
          const runs = valid.filter((r) => r.model_id === mid);
          const accVals = runs.map((r) => r.accuracy ?? r.normalized_average_score).filter((v) => v != null);
          const xVals = xPicker(runs).filter((v) => v != null);
          if (accVals.length === 0 || xVals.length === 0) return null;
          const avgAcc = accVals.reduce((a, b) => a + b, 0) / accVals.length;
          const avgX = xVals.reduce((a, b) => a + b, 0) / xVals.length;
          return {
            data: [{ x: avgX, y: parseFloat((avgAcc * 100).toFixed(1)), id: mid }],
            label: modelLabels[idx],
            color: JUDGE_COLORS[idx % JUDGE_COLORS.length],
          };
        }).filter(Boolean);

      const costSeries = mkSeries((runs) => runs.map((r) => r.estimated_cost_usd).filter((v) => v != null && v > 0));
      const latSeries = mkSeries((runs) => runs.map((r) => r.e2e_response_time_median_ms));

      const subCharts = [
        ...(costSeries.length >= 2 ? [{ series: costSeries, xLabel: "Cost per run (USD)", yLabel: "Accuracy (%)", yMin: 0, yMax: 100, xMin: 0 }] : []),
        ...(latSeries.length >= 2 ? [{ series: latSeries, xLabel: "E2E Latency (ms)", yLabel: "Accuracy (%)", yMin: 0, yMax: 100, xMin: 0 }] : []),
      ];

      return { label: "Accuracy vs Cost & Latency", type: "scatter-pair", hasData: subCharts.length > 0, subCharts };
    })(),
  ];

  const charts = allCharts.filter((c) => c.hasData);
  if (charts.length === 0) return null;

  const activeTab = Math.min(tab, charts.length - 1);
  const activeChart = charts[activeTab];
  const { type = "bar", labels, series, yLabel, min, max } = activeChart;

  return (
    <Paper sx={cardSx}>
      <Tabs
        value={activeTab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 2, borderBottom: "1px solid rgba(25,118,210,0.1)" }}
        TabIndicatorProps={{ style: { backgroundColor: "#1565c0" } }}
      >
        {charts.map((c) => (
          <Tab
            key={c.label}
            label={c.label}
            sx={{ textTransform: "none", fontWeight: 600, fontSize: "0.88rem" }}
          />
        ))}
      </Tabs>
      {type === "scatter-pair" ? (
        <Box sx={{ display: "flex", justifyContent: "center", gap: 1 }}>
          {activeChart.subCharts.map((sc, i) => (
            <Box key={i} sx={{ width: "46%", flexShrink: 0 }}>
              <ScatterChart
                series={sc.series}
                xAxis={[{ label: sc.xLabel, min: sc.xMin }]}
                yAxis={[{ label: sc.yLabel, min: sc.yMin, ...(sc.yMax != null ? { max: sc.yMax } : {}) }]}
                height={300}
                margin={{ left: 54, right: 16, top: 16, bottom: 48 }}
              />
            </Box>
          ))}
        </Box>
      ) : (
        <BarChart
          series={series}
          xAxis={[{ data: labels, scaleType: "band", tickLabelStyle: { fontSize: 11 } }]}
          yAxis={[{ label: yLabel, min, ...(max != null ? { max } : {}) }]}
          height={300}
          margin={{ left: 60, right: 20, top: 20, bottom: 70 }}
        />
      )}
    </Paper>
  );
};

const Experiment = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [experiment, setExperiment] = React.useState(null);
  const [datasetName, setDatasetName] = React.useState("");
  const [modelNames, setModelNames] = React.useState({});
  const [modelBaseNames, setModelBaseNames] = React.useState({});
  const [modelDetails, setModelDetails] = React.useState({});
  const [judgeNames, setJudgeNames] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [deleteError, setDeleteError] = React.useState("");
  const [retrying, setRetrying] = React.useState(false);
  const [retryError, setRetryError] = React.useState("");
  const fetchExperiment = React.useCallback(() => {
    if (!id) return;
    ExperimentService.getExperiment(id)
      .then((res) => setExperiment(res?.data ?? null))
      .catch(() => setError("Failed to load experiment."))
      .finally(() => setLoading(false));
  }, [id]);

  // Initial load: experiment + dataset name + model names in parallel
  React.useEffect(() => {
    if (!id) return;
    setLoading(true);

    ExperimentService.getExperiment(id)
      .then(async (res) => {
        const exp = res?.data ?? null;
        setExperiment(exp);
        if (!exp) return;

        // Fetch dataset name
        DatasetService.getDataset(exp.dataset_id)
          .then((r) => setDatasetName(r?.data?.name ?? `Dataset #${exp.dataset_id}`))
          .catch(() => setDatasetName(`Dataset #${exp.dataset_id}`));

        // Fetch all models once and build lookup
        ModelService.getModels()
          .then((r) => {
            const map = {};
            const baseMap = {};
            const detailMap = {};
            (r?.data ?? []).forEach((m) => { map[m.id] = m.name; baseMap[m.id] = m.model_name; detailMap[m.id] = m; });
            setModelNames(map);
            setModelBaseNames(baseMap);
            setModelDetails(detailMap);
          })
          .catch(() => {});

        // Build judge model name lookup from run data
        const judgeModelIds = [...new Set((exp.runs ?? []).map((r) => r.judge_model_id).filter(Boolean))];
        if (judgeModelIds.length > 0) {
          // Fetch judge models list from context or API — use model list hack via judge-models
          fetch(`${BASE}/judge-models/`, { headers: { Authorization: `Bearer ${getToken()}` } })
            .then((r) => r.json())
            .then((data) => {
              const map = {};
              (Array.isArray(data) ? data : []).forEach((j) => { map[j.id] = j.name; });
              setJudgeNames(map);
            })
            .catch(() => {});
        }
      })
      .catch(() => setError("Failed to load experiment."))
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-poll while running
  React.useEffect(() => {
    if (!experiment) return;
    if (experiment.status !== "running") return;
    const timer = setInterval(fetchExperiment, 5000);
    return () => clearInterval(timer);
  }, [experiment, fetchExperiment]);

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError("");
    try {
      await ExperimentService.runExperiment(id);
      fetchExperiment();
    } catch {
      setRetryError("Failed to retry experiment. Please try again.");
    } finally {
      setRetrying(false);
    }
  };


  const handleDelete = async () => {
    try {
      await ExperimentService.deleteExperiment(id);
      navigate("/experiments");
    } catch {
      setDeleteError("Failed to delete experiment. It may still be running.");
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 12 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !experiment) {
    return (
      <Box sx={pageShellSx}>
        <ErrorSnackbar message={error ?? "Experiment not found."} onClose={() => setError(null)} />
      </Box>
    );
  }

  const runs = experiment.runs ?? [];
  const judgeConfigs = experiment.judge_configs ?? [];
  const isRunning = experiment.status === "running";
  const candidateModelIds = experiment.candidate_model_ids ?? [];
  const hasFailedRuns =
    experiment.status === "failed" ||
    runs.some((r) => r.status === "failed" && candidateModelIds.includes(r.model_id));
  const hasCancelledRuns = runs.some((r) => r.status === "cancelled" && candidateModelIds.includes(r.model_id));
  const hasRetryable = hasFailedRuns || hasCancelledRuns;
  const hasNewCombinations = (experiment.candidate_model_ids ?? []).some((mid) =>
    judgeConfigs.some((cfg) =>
      !runs.some(
        (r) =>
          r.model_id === mid &&
          r.judge_type === (cfg.judge_type ?? cfg.judgeType)
      )
    )
  );
  const showRunButton = !isRunning && (hasRetryable || hasNewCombinations);
  const retryLabel = hasFailedRuns && hasCancelledRuns
    ? "Retry Failed & Cancelled"
    : hasFailedRuns
    ? "Retry Failed Runs"
    : "Retry Cancelled Runs";
  const runButtonLabel =
    hasNewCombinations && hasRetryable
      ? `Run New & ${retryLabel}`
      : hasNewCombinations
      ? "Run New Models"
      : retryLabel;
  const runButtonColor = hasRetryable && !hasNewCombinations ? "warning" : "primary";

  return (
    <Box sx={pageShellSx}>
      <ErrorSnackbar message={deleteError} onClose={() => setDeleteError("")} />
      <ErrorSnackbar message={retryError} onClose={() => setRetryError("")} />
      <Stack spacing={4} sx={{ maxWidth: 1120, mx: "auto" }}>

        {/* Header */}
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" gap={1}>
            <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: "-0.03em", color: "#0f172a", fontSize: { xs: "1.8rem", md: "2.4rem" }, flex: 1 }}>
              {experiment.name}
            </Typography>
            <Chip label={experiment.status} color={STATUS_COLOR[experiment.status] ?? "default"} sx={{ fontWeight: 700 }} />
            {isRunning && <CircularProgress size={20} />}
            {showRunButton && (
              <Button
                size="small"
                color={runButtonColor}
                variant="contained"
                disabled={retrying}
                sx={{ textTransform: "none", borderRadius: 999 }}
                onClick={handleRetry}
              >
                {retrying ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                {runButtonLabel}
              </Button>
            )}
            {experiment.status !== "running" && (
              <Button
                size="small"
                variant="outlined"
                sx={{ textTransform: "none", borderRadius: 999 }}
                onClick={() => navigate("/experiments", { state: { editExp: experiment } })}
              >
                Edit
              </Button>
            )}
            {experiment.status !== "running" && (
              <Button
                size="small"
                color="error"
                variant="outlined"
                sx={{ textTransform: "none", borderRadius: 999 }}
                onClick={handleDelete}
              >
                Delete
              </Button>
            )}
          </Stack>
          {experiment.description && (
            <Typography sx={{ color: "text.secondary", fontSize: "0.92rem", maxWidth: 720 }}>
              {experiment.description}
            </Typography>
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip label={`Sample: ${experiment.sample_size}`} variant="outlined" size="small" />
            <Chip label={`Seed: ${experiment.seed}`} variant="outlined" size="small" />
            {experiment.measure_k > 0 && <Chip label={`Measure@K: ${experiment.measure_k}`} variant="outlined" size="small" />}
            <Chip label={new Date(experiment.created_at).toLocaleString()} variant="outlined" size="small" />
          </Stack>
        </Stack>

        {/* Config summary */}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 2 }}>
          <Paper sx={{ ...cardSx, p: 2 }}>
            <Typography sx={{ fontSize: "0.72rem", fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }}>Dataset</Typography>
            <Typography sx={{ fontWeight: 700 }}>{datasetName}</Typography>
          </Paper>
          <Paper sx={{ ...cardSx, p: 2 }}>
            <Typography sx={{ fontSize: "0.72rem", fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }}>Models</Typography>
            <Stack spacing={0.5}>
              {(experiment.candidate_model_ids ?? []).map((mid) => (
                <Box key={mid} sx={{ display: "flex", alignItems: "center" }}>
                  <Typography sx={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    {modelNames[mid] ?? `ID ${mid}`}
                  </Typography>
                  <ModelInfoTooltip model={modelDetails[mid]} />
                </Box>
              ))}
            </Stack>
          </Paper>
          <Paper sx={{ ...cardSx, p: 2 }}>
            <Typography sx={{ fontSize: "0.72rem", fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }}>Judges</Typography>
            <Stack spacing={0.5}>
              {judgeConfigs.map((cfg, i) => (
                <Chip key={i} label={JUDGE_TYPE_LABELS[cfg.judge_type ?? cfg.judgeType] ?? (cfg.judge_type ?? cfg.judgeType)} size="small" color="primary" variant="outlined" sx={{ width: "fit-content" }} />
              ))}
            </Stack>
          </Paper>
        </Box>

        {/* Experiment-level token totals */}
        {experiment.total_tokens != null && (
          <Paper sx={cardSx}>
            <Typography sx={{ fontWeight: 700, mb: 2 }}>Total Usage</Typography>
            <MetricGrid>
              {experiment.prompt_tokens != null && <Metric label="Prompt Tokens" value={experiment.prompt_tokens.toLocaleString()} />}
              {experiment.completion_tokens != null && <Metric label="Completion Tokens" value={experiment.completion_tokens.toLocaleString()} />}
              <Metric label="Total Tokens" value={experiment.total_tokens.toLocaleString()} />
              <Metric label="Est. Cost" value={formatCost(experiment.estimated_cost_usd)} />
            </MetricGrid>
          </Paper>
        )}

        {/* Chart */}
        <RunsChart runs={runs} modelNames={modelNames} />

        {/* AI Analysis */}
        <AnalysisPanel experiment={experiment} modelNames={modelNames} modelBaseNames={modelBaseNames} />

        {/* Runs */}
        <Stack spacing={1}>
          <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", color: "#0f172a" }}>
            {(() => {
              const expectedTotal = candidateModelIds.length * judgeConfigs.length;
              if (isRunning && expectedTotal > runs.length) {
                return `Runs (${runs.length} / ${expectedTotal})`;
              }
              return `Runs (${runs.length})`;
            })()}
          </Typography>
          {runs.length === 0 ? (
            <Paper sx={{ ...cardSx, textAlign: "center", py: 5 }}>
              <Typography sx={{ color: "text.secondary" }}>No runs yet — the experiment may still be starting up.</Typography>
            </Paper>
          ) : (
            <Stack spacing={2}>
              {runs.map((run) => (
                <RunCard key={run.id} run={run} experimentId={id} modelNames={modelNames} modelDetails={modelDetails} judgeNames={judgeNames} onCancelRun={fetchExperiment} />
              ))}
            </Stack>
          )}
        </Stack>

      </Stack>
    </Box>
  );
};

export default Experiment;
