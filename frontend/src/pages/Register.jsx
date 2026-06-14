import {
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React from "react";
import { Link, useNavigate } from "react-router";
import { register } from "../api/auth";
import ErrorSnackbar from "../components/ErrorSnackbar";
import WABSLogo from "../components/WABSLogo";
import { LlmContext, LLMTYPES } from "../context/LlmContext";
import ModelService from "../api/services/model";
import JudgeService from "../api/services/judge";

const fieldSx = {
  "& .MuiOutlinedInput-root": { borderRadius: 2 },
};

const Register = () => {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();
  const { updateLlms } = React.useContext(LlmContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !confirm.trim()) {
      setError("All fields are required.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await register(email, password);
      const [modelsRes, judgesRes] = await Promise.allSettled([
        ModelService.getModels(),
        JudgeService.getJudges(),
      ]);
      if (modelsRes.status === "fulfilled") updateLlms(LLMTYPES.MODEL, modelsRes.value?.data ?? []);
      if (judgesRes.status === "fulfilled") updateLlms(LLMTYPES.JUDGE, judgesRes.value?.data ?? []);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* ── Left panel ── */}
      <Box
        sx={{
          flex: "0 0 55%",
          background: "linear-gradient(145deg, #0f172a 0%, #1a3a6b 55%, #1565c0 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          p: "3rem 3.5rem",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative circles */}
        <Box
          sx={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.06)",
            top: -80,
            right: -100,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            width: 280,
            height: 280,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.05)",
            bottom: 60,
            left: -60,
          }}
        />

        {/* Brand */}
        <Box>
          <WABSLogo size={72} />
          <Typography
            sx={{
              fontWeight: 900,
              fontSize: "1.6rem",
              letterSpacing: "-0.05em",
              color: "#ffffff",
              mt: 1.25,
            }}
          >
            WABS
          </Typography>
          <Typography
            sx={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", mt: 0.25 }}
          >
            BENCHMARK PLATFORM
          </Typography>
        </Box>

        {/* Hero copy */}
        <Box sx={{ zIndex: 1 }}>
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: "2.6rem",
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
              color: "#ffffff",
              mb: 1.5,
            }}
          >
            Start benchmarking{" "}
            <Box component="span" sx={{ color: "#90caf9" }}>
              smarter.
            </Box>
          </Typography>
          <Typography
            sx={{
              color: "rgba(255,255,255,0.55)",
              fontSize: "1rem",
              maxWidth: 380,
              lineHeight: 1.65,
            }}
          >
            Set up your workspace in seconds. Compare models, manage datasets, and
            run reproducible evaluations at scale.
          </Typography>
        </Box>

        {/* Footer note */}
        <Typography sx={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.25)", zIndex: 1 }}>
          © 2026 WABS
        </Typography>
      </Box>

      {/* ── Right panel ── */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#ffffff",
          px: "3rem",
        }}
      >
        <Box sx={{ width: "100%", maxWidth: 400 }}>
          <Stack spacing={3.5} component="form" onSubmit={handleSubmit}>
            <Stack spacing={0.5}>
              <Typography
                variant="h4"
                sx={{ fontWeight: 800, letterSpacing: "-0.03em", color: "#0f172a" }}
              >
                Create an account
              </Typography>
              <Typography sx={{ color: "text.secondary", fontSize: "0.95rem" }}>
                Get started with your benchmark workspace.
              </Typography>
            </Stack>

            <ErrorSnackbar message={error} onClose={() => setError("")} />

            <Stack spacing={2}>
              <TextField
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                fullWidth
                required
                autoComplete="email"
                autoFocus
                sx={fieldSx}
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                fullWidth
                required
                autoComplete="new-password"
                helperText="At least 8 characters."
                sx={fieldSx}
              />
              <TextField
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                fullWidth
                required
                autoComplete="new-password"
                sx={fieldSx}
              />
            </Stack>

            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={loading}
              sx={{
                py: 1.4,
                borderRadius: 999,
                textTransform: "none",
                fontWeight: 700,
                fontSize: "1rem",
                boxShadow: "0 4px 20px rgba(21,101,192,0.35)",
              }}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}
            >
              {loading ? "Creating account…" : "Create account"}
            </Button>

            <Typography sx={{ textAlign: "center", color: "text.secondary", fontSize: "0.9rem" }}>
              Already have an account?{" "}
              <Link
                to="/login"
                style={{ color: "#1565c0", fontWeight: 600, textDecoration: "none" }}
              >
                Sign in
              </Link>
            </Typography>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};

export default Register;
