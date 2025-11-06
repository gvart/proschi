import { useState, useEffect } from 'react';
import InfrastructureCanvas from './components/Canvas/InfrastructureCanvas';
import TopNavBar from './components/TopNavBar';
import ProjectList from './components/ProjectList';
import { useCanvasStore } from './store/canvasStore';
import './App.css';

function App() {
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const currentProject = useCanvasStore((state) => state.currentProject);

  // Sync local state with Zustand store when project changes
  useEffect(() => {
    if (currentProject) {
      setCurrentProjectId(currentProject.id);
    }
  }, [currentProject]);

  const handleBackToProjects = () => {
    setCurrentProjectId(null);
    useCanvasStore.getState().setCurrentProject(null);
  };

  if (!currentProjectId) {
    return <ProjectList onProjectOpen={setCurrentProjectId} />;
  }

  return (
    <div className="w-full h-screen flex flex-col">
      <TopNavBar onBackToProjects={handleBackToProjects} />
      <div className="flex-1 overflow-hidden">
        <InfrastructureCanvas projectId={currentProjectId} />
      </div>
    </div>
  );
}

export default App;
