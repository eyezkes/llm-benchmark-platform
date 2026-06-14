import Dashboard from "./Dashboard/Dashboard";

export default function withDashboard(WrappedComponent) {
  return function NewComponent() {
    return (
      <Dashboard>
        <WrappedComponent />
      </Dashboard>
    );
  };
}
