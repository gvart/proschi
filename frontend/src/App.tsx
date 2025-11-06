import { useState } from 'react';
import InfrastructureCanvas from './components/Canvas/InfrastructureCanvas';
import TopNavBar from './components/TopNavBar';
import ProjectList from './components/ProjectList';
import './App.css';

function App() {
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  const handleBackToProjects = () => {
    setCurrentProjectId(null);
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
