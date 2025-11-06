import InfrastructureCanvas from './components/Canvas/InfrastructureCanvas';
import TopNavBar from './components/TopNavBar';
import ProjectList from './components/ProjectList';
import { useCanvasStore } from './store/canvasStore';
import './App.css';

function App() {
  const currentProject = useCanvasStore((state) => state.currentProject);
  const loadProject = useCanvasStore((state) => state.loadProject);
  const setCurrentProject = useCanvasStore((state) => state.setCurrentProject);

  const handleProjectOpen = async (projectId: string) => {
    await loadProject(projectId);
  };

  const handleBackToProjects = () => {
    setCurrentProject(null);
  };

  if (!currentProject) {
    return <ProjectList onProjectOpen={handleProjectOpen} />;
  }

  return (
    <div className="w-full h-screen flex flex-col">
      <TopNavBar onBackToProjects={handleBackToProjects} />
      <div className="flex-1 overflow-hidden">
        <InfrastructureCanvas />
      </div>
    </div>
  );
}

export default App;
