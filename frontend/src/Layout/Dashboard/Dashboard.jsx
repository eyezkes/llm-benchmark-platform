import React from "react";
import { useLocation } from "react-router";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import TextSnippetOutlinedIcon from "@mui/icons-material/TextSnippetOutlined";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";

import { logout, getToken } from "../../api/auth";
import WABSLogo from "../../components/WABSLogo";

const BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

const navItems = [
  { label: "Home", path: "/", icon: HomeOutlinedIcon },
  { label: "Models", path: "/models", icon: MemoryOutlinedIcon },
  { label: "Judge Models", path: "/judges", icon: GavelOutlinedIcon },
  { label: "Datasets", path: "/datasets", icon: StorageOutlinedIcon },
  { label: "Experiments", path: "/experiments", icon: ScienceOutlinedIcon },
];

export default function Dashboard({ children }) {
  const location = useLocation();
  const [email, setEmail] = React.useState("");
  const [menuAnchor, setMenuAnchor] = React.useState(null);
  React.useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setEmail(data.email ?? ""))
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  const isActive = (path) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <Box
      component="section"
      sx={{
        width: "100%",
        height: "100%",
        position: "fixed",
        overflow: "hidden",
        top: 0,
        left: 0,
        display: "flex",
      }}
    >
      {/* ── Sidebar ── */}
      <Box
        component="nav"
        sx={{
          width: "17rem",
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(180deg, #ffffff 0%, #f4f8ff 100%)",
          borderRight: "1px solid rgba(25,118,210,0.1)",
          boxShadow: "4px 0 24px rgba(15,23,42,0.05)",
        }}
      >
        {/* Brand */}
        <Box sx={{ px: 3, pt: 4, pb: 3 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <WABSLogo size={34} color="#1565c0" />
            <Box>
              <Typography
                sx={{
                  fontWeight: 800,
                  fontSize: "1.35rem",
                  letterSpacing: "-0.04em",
                  color: "#1565c0",
                  lineHeight: 1.1,
                }}
              >
                WABS
              </Typography>
              <Typography sx={{ fontSize: "0.72rem", color: "text.secondary", letterSpacing: "0.02em" }}>
                LLM Benchmark Platform
              </Typography>
            </Box>
          </Stack>
        </Box>

        <Divider sx={{ borderColor: "rgba(25,118,210,0.08)", mx: 2 }} />

        {/* Nav items */}
        <Stack spacing={0.25} sx={{ px: 1.5, pt: 2 }}>
          <Typography
            sx={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.09em",
              color: "rgba(15,23,42,0.3)",
              textTransform: "uppercase",
              px: 1.5,
              pb: 0.75,
            }}
          >
            Workspace
          </Typography>

          {navItems.map(({ label, path, icon: Icon }) => {
            const active = isActive(path);
            return (
              <Box
                key={path}
                onClick={() => { window.location.href = path; }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.75,
                  px: 1.75,
                  py: 1.25,
                  borderRadius: 2,
                  cursor: "pointer",
                  color: active ? "#1565c0" : "rgba(15,23,42,0.5)",
                  fontWeight: active ? 700 : 500,
                  fontSize: "1rem",
                  borderLeft: active ? "3px solid #1565c0" : "3px solid transparent",
                  backgroundColor: active ? "rgba(25,118,210,0.06)" : "transparent",
                  "&:hover": {
                    backgroundColor: active ? "rgba(25,118,210,0.08)" : "rgba(15,23,42,0.04)",
                    color: active ? "#1565c0" : "rgba(15,23,42,0.75)",
                  },
                  transition: "all 0.15s ease",
                  userSelect: "none",
                }}
              >
                <Icon sx={{ fontSize: "1.35rem", flexShrink: 0 }} />
                <Typography sx={{ fontWeight: "inherit", fontSize: "inherit", color: "inherit" }}>
                  {label}
                </Typography>
              </Box>
            );
          })}
        </Stack>

        <Box sx={{ flex: 1 }} />

        {/* ── Bottom: user + logout ── */}
        <Box sx={{ px: 2, pb: 3 }}>
          <Divider sx={{ borderColor: "rgba(25,118,210,0.08)", mb: 2 }} />

          {email && (
            <>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                sx={{
                  mb: 1.5,
                  px: 1.5,
                  py: 1,
                  borderRadius: 2.5,
                  background: "rgba(25,118,210,0.05)",
                  border: "1px solid rgba(25,118,210,0.1)",
                  cursor: "pointer",
                  userSelect: "none",
                  "&:hover": {
                    background: "rgba(25,118,210,0.09)",
                    borderColor: "rgba(25,118,210,0.2)",
                  },
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    bgcolor: "rgba(25,118,210,0.15)",
                    color: "#1565c0",
                  }}
                >
                  {email[0].toUpperCase()}
                </Avatar>
                <Typography
                  sx={{
                    fontSize: "0.8rem",
                    color: "rgba(15,23,42,0.65)",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {email}
                </Typography>
                <Typography sx={{ fontSize: "0.65rem", color: "rgba(15,23,42,0.35)", flexShrink: 0 }}>
                  ▲
                </Typography>
              </Stack>

              <Menu
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={() => setMenuAnchor(null)}
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
                transformOrigin={{ vertical: "bottom", horizontal: "center" }}
                slotProps={{
                  paper: {
                    sx: {
                      width: "13rem",
                      borderRadius: 2.5,
                      border: "1px solid rgba(25,118,210,0.12)",
                      boxShadow: "0 8px 32px rgba(15,23,42,0.1)",
                      py: 0.5,
                    },
                  },
                }}
              >
                <MenuItem
                  onClick={() => { setMenuAnchor(null); window.location.href = "/prompts"; }}
                  sx={{ fontSize: "0.88rem", fontWeight: 600, py: 1.2, borderRadius: 1.5, mx: 0.5, color: "rgba(15,23,42,0.55)", display: "flex", gap: 1, alignItems: "center" }}
                >
                  <TextSnippetOutlinedIcon sx={{ fontSize: "1rem" }} />
                  Prompt Library
                </MenuItem>
                <MenuItem
                  onClick={() => { setMenuAnchor(null); window.location.href = "/api-keys"; }}
                  sx={{ fontSize: "0.88rem", fontWeight: 600, py: 1.2, borderRadius: 1.5, mx: 0.5, color: "rgba(15,23,42,0.55)", display: "flex", gap: 1, alignItems: "center" }}
                >
                  <VpnKeyOutlinedIcon sx={{ fontSize: "1rem" }} />
                  API Keys
                </MenuItem>
              </Menu>
            </>
          )}

          <Button
            fullWidth
            onClick={() => { window.location.href = "/change-password"; }}
            sx={{
              justifyContent: "center",
              textTransform: "none",
              borderRadius: 2.5,
              px: 2,
              py: 0.9,
              fontWeight: 600,
              fontSize: "0.9rem",
              color: "rgba(15,23,42,0.45)",
              "&:hover": { backgroundColor: "rgba(15,23,42,0.04)" },
            }}
          >
            Change password
          </Button>

          <Button
            fullWidth
            onClick={handleLogout}
            sx={{
              justifyContent: "center",
              textTransform: "none",
              borderRadius: 2.5,
              px: 2,
              py: 0.9,
              fontWeight: 600,
              fontSize: "0.9rem",
              color: "#e53935",
              "&:hover": {
                backgroundColor: "rgba(229,57,53,0.07)",
              },
            }}
          >
            Log out
          </Button>
        </Box>
      </Box>

      {/* ── Main content ── */}
      <Box
        component="div"
        sx={{ overflowX: "hidden", overflowY: "scroll", width: "inherit" }}
      >
        {children}
      </Box>
    </Box>
  );
}
