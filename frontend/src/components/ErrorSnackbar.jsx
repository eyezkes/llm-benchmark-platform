import { Alert, Snackbar } from "@mui/material";

const ErrorSnackbar = ({ message, onClose }) => (
  <Snackbar
    open={!!message}
    autoHideDuration={6000}
    onClose={onClose}
    anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
  >
    <Alert severity="error" onClose={onClose} sx={{ width: "100%" }}>
      {message}
    </Alert>
  </Snackbar>
);

export default ErrorSnackbar;
