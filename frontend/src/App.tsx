import InfrastructureCanvas from './components/Canvas/InfrastructureCanvas';
import WorkspaceSelector from './components/Canvas/WorkspaceSelector';
import './App.css';

function App() {
  return (
    <div className="relative w-full h-screen">
      <InfrastructureCanvas />
      <WorkspaceSelector />
    </div>
  );
}

export default App;
