import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React from "react";
import ApiKeyService from "../api/services/apiKey";
import { VENDOR_LABELS } from "../constants/modelConfig";
import ErrorSnackbar from "../components/ErrorSnackbar";

const pageShellSx = {
  minHeight: "100vh",
  px: { xs: 2, md: 4 },
  py: { xs: 3, md: 5 },
  background:
    "radial-gradient(circle at top left, rgba(25,118,210,0.14), transparent 32%), radial-gradient(circle at top right, rgba(100,181,246,0.18), transparent 28%), linear-gradient(180deg, #f7fbff 0%, #eef4fb 100%)",
};

const frameSx = {
  maxWidth: 760,
  mx: "auto",
};

const sectionCardSx = {
  p: { xs: 2, md: 3 },
  borderRadius: 4,
  border: "1px solid rgba(25,118,210,0.12)",
  boxShadow: "0 14px 35px rgba(15, 23, 42, 0.06)",
};

const VENDORS = Object.keys(VENDOR_LABELS).filter((v) => v !== "local");
const VENDOR_LABEL = (v) => VENDOR_LABELS[v] ?? v;

const AddKeyForm = ({ onCreated }) => {
  const [vendor, setVendor] = React.useState("openai");
  const [label, setLabel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!label.trim()) { setError("Label is required."); return; }
    if (!apiKey.trim()) { setError("API key is required."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await ApiKeyService.createKey({ vendor, label: label.trim(), api_key: apiKey.trim() });
      onCreated(res.data);
      setLabel("");
      setApiKey("");
    } catch (err) {
      setError(err?.data?.detail ?? err?.message ?? "Failed to save key.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper sx={{ ...sectionCardSx, background: "linear-gradient(180deg, rgba(248,251,255,1) 0%, rgba(237,246,255,1) 100%)" }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Add new key</Typography>
      <Stack spacing={2} component="form" onSubmit={handleSubmit}>
        {error && (
          <Alert severity="error" onClose={() => setError("")} sx={{ borderRadius: 2 }}>
            {error}
          </Alert>
        )}
        <FormControl fullWidth size="small">
          <InputLabel>Vendor</InputLabel>
          <Select value={vendor} onChange={(e) => setVendor(e.target.value)} label="Vendor">
            {VENDORS.map((v) => (
              <MenuItem key={v} value={v}>{VENDOR_LABEL(v)}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Label"
          size="small"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          fullWidth
          placeholder="e.g. Production OpenAI key"
          helperText="A friendly name to identify this key."
        />
        <TextField
          label="API Key"
          size="small"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          fullWidth
          autoComplete="off"
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ borderRadius: 999, textTransform: "none", fontWeight: 700, px: 3 }}
            startIcon={loading ? <CircularProgress size={15} color="inherit" /> : null}
          >
            {loading ? "Saving…" : "Save key"}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
};

const KeyRow = ({ item, onDelete }) => {
  const [deleting, setDeleting] = React.useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await ApiKeyService.deleteKey(item.id);
      onDelete(item.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <ListItem
      sx={{ px: 0, py: 1.25, borderBottom: "1px solid rgba(15,23,42,0.06)" }}
      secondaryAction={
        <IconButton
          size="small"
          onClick={handleDelete}
          disabled={deleting}
          sx={{ color: "#e53935", "&:hover": { background: "rgba(229,57,53,0.08)" } }}
        >
          {deleting ? <CircularProgress size={16} /> : "✕"}
        </IconButton>
      }
    >
      <Box sx={{ flex: 1, minWidth: 0, pr: 5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: "0.9rem" }}>{item.label}</Typography>
        <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", fontFamily: "monospace" }}>
          {item.masked}
        </Typography>
      </Box>
    </ListItem>
  );
};

const MyApiKeys = () => {
  const [keys, setKeys] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    ApiKeyService.getKeys()
      .then((res) => setKeys(res?.data ?? []))
      .catch(() => setError("Failed to load saved keys."))
      .finally(() => setLoading(false));
  }, []);

  const handleCreated = (newKey) => setKeys((prev) => [...prev, newKey]);
  const handleDelete = (id) => setKeys((prev) => prev.filter((k) => k.id !== id));

  const byVendor = VENDORS.reduce((acc, v) => {
    const vendorKeys = keys.filter((k) => k.vendor === v);
    if (vendorKeys.length) acc[v] = vendorKeys;
    return acc;
  }, {});

  return (
    <Box sx={pageShellSx}>
      <Box sx={frameSx}>
        <Stack spacing={0.5} sx={{ mb: 4 }}>
          <Typography variant="h4" sx={{ fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
            API Keys
          </Typography>
          <Typography sx={{ color: "text.secondary", fontSize: "0.92rem" }}>
            Save vendor API keys once and reuse them when creating models or judges. Keys are encrypted at rest.
          </Typography>
        </Stack>

        <Stack spacing={3}>
          <AddKeyForm onCreated={handleCreated} />

          {error && (
            <Alert severity="error" onClose={() => setError("")} sx={{ borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : keys.length === 0 ? (
            <Paper sx={sectionCardSx}>
              <Typography sx={{ color: "text.secondary", fontSize: "0.88rem" }}>
                No saved keys yet. Add one above.
              </Typography>
            </Paper>
          ) : (
            Object.entries(byVendor).map(([vendor, vendorKeys]) => (
              <Paper key={vendor} sx={sectionCardSx}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Chip
                    label={VENDOR_LABEL(vendor)}
                    size="small"
                    variant="outlined"
                    color="primary"
                    sx={{ borderRadius: 999, fontWeight: 700 }}
                  />
                  <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
                    {vendorKeys.length} key{vendorKeys.length !== 1 ? "s" : ""}
                  </Typography>
                </Stack>
                <Divider sx={{ mb: 0.5, borderColor: "rgba(25,118,210,0.08)" }} />
                <List sx={{ p: 0 }}>
                  {vendorKeys.map((k) => (
                    <KeyRow key={k.id} item={k} onDelete={handleDelete} />
                  ))}
                </List>
              </Paper>
            ))
          )}
        </Stack>
      </Box>
      <ErrorSnackbar />
    </Box>
  );
};

export default MyApiKeys;
