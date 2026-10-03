import { useState } from 'react';
import InfrastructureCanvas from './components/Canvas/InfrastructureCanvas';
import TopNavBar from './components/TopNavBar';
import ProjectList from './components/ProjectList';
import UseCaseListView from './components/UseCases/UseCaseListView';
import UseCaseEditor from './components/UseCases/UseCaseEditor';
import UseCasePlayback from './components/UseCases/UseCasePlayback';
import Playground from './components/Playground/Playground';
import { useCanvasStore } from './store/canvasStore';
import { loadJson, saveJson } from './services/storage';
import { decodeShareHash } from './playground/share';
import './App.css';

type AppMode = 'playground' | 'builder';
const MODE_KEY = 'proschi.mode';

function App() {
  // A share link always opens in the text editor.
  const [mode, setModeState] = useState<AppMode>(() =>
    decodeShareHash(window.location.hash) !== null ? 'playground' : loadJson<AppMode>(MODE_KEY, 'playground')
  );
  const setMode = (next: AppMode) => {
    setModeState(next);
    saveJson(MODE_KEY, next);
    // The diagram link only belongs to the text editor; drop it so a reload stays in the builder.
    if (next === 'builder') window.history.replaceState(null, '', window.location.pathname + window.location.search);
  };
  const currentProject = useCanvasStore((state) => state.currentProject);
  const viewMode = useCanvasStore((state) => state.viewMode);
  const setViewMode = useCanvasStore((state) => state.setViewMode);
  const loadProject = useCanvasStore((state) => state.loadProject);
  const setCurrentProject = useCanvasStore((state) => state.setCurrentProject);

  const [editingUseCaseId, setEditingUseCaseId] = useState<string | null>(null);
  const [playingUseCaseId, setPlayingUseCaseId] = useState<string | null>(null);

  const handleProjectOpen = async (projectId: string) => {
    await loadProject(projectId);
    setViewMode('architecture');
  };

  const handleBackToProjects = () => {
    setCurrentProject(null);
    setViewMode('architecture');
    setEditingUseCaseId(null);
    setPlayingUseCaseId(null);
  };

  const handleEditUseCase = (useCaseId: string) => {
    setEditingUseCaseId(useCaseId);
  };

  const handlePlayUseCase = (useCaseId: string) => {
    setPlayingUseCaseId(useCaseId);
    setViewMode('playback');
  };

  const handleBackToUseCaseList = () => {
    setEditingUseCaseId(null);
    setPlayingUseCaseId(null);
    setViewMode('usecases');
  };

  if (mode === 'playground') {
    return <Playground onOpenBuilder={() => setMode('builder')} />;
  }

  if (!currentProject) {
    return <ProjectList onProjectOpen={handleProjectOpen} onOpenPlayground={() => setMode('playground')} />;
  }

  return (
    <div className="w-full h-screen flex flex-col">
      <TopNavBar onBackToProjects={handleBackToProjects} />
      <div className="flex-1 overflow-hidden">
        {viewMode === 'architecture' && <InfrastructureCanvas />}

        {viewMode === 'usecases' && !editingUseCaseId && (
          <UseCaseListView
            projectId={currentProject.id}
            onEditUseCase={handleEditUseCase}
            onPlayUseCase={handlePlayUseCase}
          />
        )}

        {viewMode === 'usecases' && editingUseCaseId && (
          <UseCaseEditor
            useCaseId={editingUseCaseId}
            onBack={handleBackToUseCaseList}
            onPlay={handlePlayUseCase}
          />
        )}

        {viewMode === 'playback' && playingUseCaseId && (
          <UseCasePlayback
            useCaseId={playingUseCaseId}
            onBack={handleBackToUseCaseList}
          />
        )}
      </div>
    </div>
  );
}

export default App;
