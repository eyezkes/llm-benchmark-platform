import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React from "react";
import { useNavigate } from "react-router";
import { changePassword } from "../api/auth";

const ChangePassword = () => {
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!oldPassword.trim() || !newPassword.trim() || !confirm.trim()) {
      setError("All fields are required.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      setSuccess(true);
      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        p: 4,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        minHeight: "100%",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 480,
          mt: 6,
          p: 4,
          borderRadius: 4,
          border: "1px solid rgba(25,118,210,0.12)",
          boxShadow: "0 8px 40px rgba(15,23,42,0.08)",
        }}
      >
        <Stack spacing={3} component="form" onSubmit={handleSubmit}>
          <Stack spacing={0.5}>
            <Typography
              variant="h5"
              sx={{ fontWeight: 800, letterSpacing: "-0.03em", color: "#0f172a" }}
            >
              Change password
            </Typography>
            <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>
              Enter your current password and choose a new one.
            </Typography>
          </Stack>

          {error && (
            <Alert severity="error" onClose={() => setError("")} sx={{ borderRadius: 2 }}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ borderRadius: 2 }}>
              Password changed successfully. Redirecting…
            </Alert>
          )}

          <Stack spacing={2}>
            <TextField
              label="Current password"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              fullWidth
              required
              autoFocus
              autoComplete="current-password"
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              required
              autoComplete="new-password"
              helperText="At least 8 characters."
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              fullWidth
              required
              autoComplete="new-password"
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
            />
          </Stack>

          <Stack direction="row" spacing={1.5}>
            <Button
              variant="outlined"
              onClick={() => navigate(-1)}
              sx={{
                flex: 1,
                py: 1.2,
                borderRadius: 999,
                textTransform: "none",
                fontWeight: 600,
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={loading || success}
              sx={{
                flex: 2,
                py: 1.2,
                borderRadius: 999,
                textTransform: "none",
                fontWeight: 700,
                boxShadow: "0 4px 16px rgba(21,101,192,0.3)",
              }}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {loading ? "Saving…" : "Save new password"}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
};

export default ChangePassword;
