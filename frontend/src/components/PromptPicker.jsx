import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import PromptService from "../api/services/prompt";

const DATASET_LABELS = {
  mc_with_true: "MC",
  open_with_true: "With ref",
  no_true_answer: "No ref",
};
const EVAL_LABELS = {
  equals: "Equals",
  contains: "Contains",
  json_equals: "JSON",
  similarity: "Similarity",
  llm_bool: "Binary",
  llm_score: "LLM Score",
};

export default function PromptPicker({ promptType, onLoad, onAppend, disabled, onLoadFull }) {
  const [open, setOpen] = React.useState(false);
  const [prompts, setPrompts] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState(null);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    PromptService.getPrompts({ prompt_type: promptType })
      .then((res) => setPrompts(res?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, promptType]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return prompts;
    const s = search.toLowerCase();
    return prompts.filter(
      (p) => p.name.toLowerCase().includes(s) || p.content.toLowerCase().includes(s)
    );
  }, [prompts, search]);

  const close = () => {
    setOpen(false);
    setSelected(null);
    setSearch("");
  };

  return (
    <>
      <Button
        size="small"
        onClick={() => setOpen(true)}
        disabled={disabled}
        sx={{ textTransform: "none", fontSize: "0.78rem", color: "#1565c0", p: 0, minWidth: 0 }}
      >
        Browse library
      </Button>

      <Dialog open={open} onClose={close} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 4, maxHeight: "80vh", display: "flex", flexDirection: "column" } }}>
        <Box sx={{ px: 3, pt: 3, pb: 1.5, borderBottom: "1px solid rgba(25,118,210,0.1)", flexShrink: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", mb: 1.5 }}>Prompt Library</Typography>
          <TextField
            placeholder="Search by name or content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
            size="small"
            slotProps={{ input: { sx: { borderRadius: 2 } } }}
          />
        </Box>

        <Box sx={{ overflowY: "auto", flex: 1, px: 1.5, py: 1 }}>
          {loading ? (
            <Typography sx={{ p: 2, color: "text.secondary", fontSize: "0.85rem" }}>Loading...</Typography>
          ) : filtered.length === 0 ? (
            <Typography sx={{ p: 2, color: "text.secondary", fontSize: "0.85rem" }}>No prompts found.</Typography>
          ) : (
            <List sx={{ p: 0 }}>
              {filtered.map((p) => (
                <ListItem
                  key={p.id}
                  onClick={() => setSelected(p)}
                  sx={{
                    borderRadius: 2,
                    mb: 0.5,
                    cursor: "pointer",
                    border: selected?.id === p.id
                      ? "1px solid rgba(25,118,210,0.35)"
                      : "1px solid rgba(15,23,42,0.07)",
                    backgroundColor: selected?.id === p.id ? "rgba(25,118,210,0.06)" : "transparent",
                    "&:hover": { backgroundColor: selected?.id === p.id ? "rgba(25,118,210,0.08)" : "rgba(15,23,42,0.03)" },
                    px: 1.5, py: 1, alignItems: "flex-start",
                  }}
                >
                  <Box sx={{ width: "100%" }}>
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }} flexWrap="wrap">
                      <Typography sx={{ fontWeight: 600, fontSize: "0.875rem" }}>{p.name}</Typography>
                      {p.is_builtin && (
                        <Chip label="Built-in" size="small" sx={{ fontSize: "0.62rem", height: 16, bgcolor: "rgba(25,118,210,0.1)", color: "#1565c0", fontWeight: 600 }} />
                      )}
                    </Stack>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 0.625 }}>
                      {p.dataset_type && (
                        <Chip label={DATASET_LABELS[p.dataset_type] ?? p.dataset_type} size="small" color="info" variant="outlined" sx={{ fontSize: "0.62rem", height: 16 }} />
                      )}
                      {p.eval_type && (() => {
                        let label = EVAL_LABELS[p.eval_type] ?? p.eval_type;
                        if (p.eval_type === "llm_score" && p.score_min != null && p.score_max != null) {
                          label = `Score ${p.score_min}–${p.score_max}`;
                        }
                        return <Chip label={label} size="small" color="success" variant="outlined" sx={{ fontSize: "0.62rem", height: 16 }} />;
                      })()}
                    </Stack>
                    <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {p.content}
                    </Typography>
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </Box>

        <Box sx={{ px: 3, py: 2, borderTop: "1px solid rgba(25,118,210,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <Button onClick={close} sx={{ textTransform: "none", color: "text.secondary" }}>Cancel</Button>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={() => { onAppend(selected.content); close(); }}
              disabled={!selected}
              sx={{ textTransform: "none", borderRadius: 999, fontSize: "0.82rem" }}
            >
              Append
            </Button>
            <Button
              variant="contained"
              onClick={() => { onLoad(selected.content); onLoadFull?.(selected); close(); }}
              disabled={!selected}
              sx={{ textTransform: "none", borderRadius: 999, fontSize: "0.82rem" }}
            >
              Load
            </Button>
          </Stack>
        </Box>
      </Dialog>
    </>
  );
}
