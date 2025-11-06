import { useState, useEffect } from 'react';
import InfrastructureCanvas from './components/Canvas/InfrastructureCanvas';
import WorkspaceSelector from './components/Canvas/WorkspaceSelector';
import ProjectList from './components/ProjectList';
import { mockApi } from './services/mockApi';
import { ArrowLeft } from 'lucide-react';
import './App.css';

function App() {
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');

  useEffect(() => {
    if (currentProjectId) {
      loadProject(currentProjectId);
    }
  }, [currentProjectId]);

  const loadProject = async (projectId: string) => {
    try {
      const project = await mockApi.getProject(projectId);
      if (project) {
        setProjectName(project.name);
        mockApi.setCurrentProject(project);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  };

  const handleBackToProjects = () => {
    setCurrentProjectId(null);
    setProjectName('');
  };

  if (!currentProjectId) {
    return <ProjectList onProjectOpen={setCurrentProjectId} />;
  }

  return (
    <div className="relative w-full h-screen">
      {/* Back to Projects Button */}
      <button
        onClick={handleBackToProjects}
        className="absolute top-4 left-4 z-10 flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
      >
        <ArrowLeft size={20} />
        <span className="font-medium">Back to Projects</span>
      </button>

      {/* Project Name Display */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm">
        <span className="font-semibold text-gray-900">{projectName}</span>
      </div>

      <InfrastructureCanvas projectId={currentProjectId} />
      <WorkspaceSelector />
    </div>
  );
}

export default App;
