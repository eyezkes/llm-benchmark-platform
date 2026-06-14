import DashboardComponent from "./pages/MVPDashboard";
import ExperimentsComponent from "./pages/Experiments";
import ExperimentComponent from "./pages/Experiment";
import ModelsComponent from "./pages/Models";
import JudgesComponent from "./pages/Judges";
import DatasetsComponent from "./pages/Datasets";
import ChangePasswordComponent from "./pages/ChangePassword";
import MyApiKeysComponent from "./pages/MyApiKeys";
import PromptsComponent from "./pages/Prompts";
import Login from "./pages/Login";
import Register from "./pages/Register";
import withDashboard from "./Layout/WithDashboard";

import "./App.css";
import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import LlmContextProvider from "./context/LlmContext";
import { getToken } from "./api/auth";

const ProtectedRoute = ({ element }) => {
  return getToken() ? element : <Navigate to="/login" replace />;
};

function App() {
  const Dashboard = withDashboard(DashboardComponent);
  const Experiments = withDashboard(ExperimentsComponent);
  const Experiment = withDashboard(ExperimentComponent);
  const Models = withDashboard(ModelsComponent);
  const Judges = withDashboard(JudgesComponent);
  const Datasets = withDashboard(DatasetsComponent);
  const ChangePassword = withDashboard(ChangePasswordComponent);
  const MyApiKeys = withDashboard(MyApiKeysComponent);
  const Prompts = withDashboard(PromptsComponent);

  return (
    <BrowserRouter>
      <LlmContextProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<ProtectedRoute element={<Dashboard />} />} />
          <Route path="/experiments" element={<ProtectedRoute element={<Experiments />} />} />
          <Route path="/experiments/:id" element={<ProtectedRoute element={<Experiment />} />} />
          <Route path="/models" element={<ProtectedRoute element={<Models />} />} />
          <Route path="/judges" element={<ProtectedRoute element={<Judges />} />} />
          <Route path="/datasets" element={<ProtectedRoute element={<Datasets />} />} />
          <Route path="/change-password" element={<ProtectedRoute element={<ChangePassword />} />} />
          <Route path="/api-keys" element={<ProtectedRoute element={<MyApiKeys />} />} />
          <Route path="/prompts" element={<ProtectedRoute element={<Prompts />} />} />
        </Routes>
      </LlmContextProvider>
    </BrowserRouter>
  );
}

export default App;
