import { useState, useEffect } from 'react';
import { FolderOpen, Plus, Save } from 'lucide-react';
import { mockApi } from '../../services/mockApi';
import { useCanvasStore } from '../../store/canvasStore';
import { Project } from '../../types/canvas';

export default function WorkspaceSelector() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const currentProject = useCanvasStore((state) => state.currentProject);
  const loadProject = useCanvasStore((state) => state.loadProject);
  const saveCanvas = useCanvasStore((state) => state.saveCanvas);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const projects = await mockApi.getProjects();
    setProjects(projects);
  };

  const handleSelectProject = async (projectId: string) => {
    await loadProject(projectId);
  };

  const handleCreateProject = async () => {
    if (newProjectName.trim()) {
      const newProject = await mockApi.createProject(newProjectName.trim());
      setProjects([...projects, newProject]);
      setNewProjectName('');
      setShowNewProject(false);
      await loadProject(newProject.id);
    }
  };

  const handleSave = async () => {
    await saveCanvas();
    alert('Canvas saved successfully!');
  };

  return (
    <div className="absolute top-4 left-80 z-10 bg-white rounded-lg shadow-lg">
      <div className="flex items-center gap-2 p-3 border-b border-gray-200">
        <FolderOpen className="w-4 h-4 text-gray-600" />
        <select
          value={currentProject?.id || ''}
          onChange={(e) => handleSelectProject(e.target.value)}
          className="flex-1 text-sm border-none focus:outline-none bg-transparent cursor-pointer"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 p-2">
        <button
          onClick={() => setShowNewProject(!showNewProject)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          <Plus className="w-3 h-3" />
          New
        </button>

        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
        >
          <Save className="w-3 h-3" />
          Save
        </button>
      </div>

      {showNewProject && (
        <div className="p-3 border-t border-gray-200">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
            placeholder="Project name"
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreateProject}
              className="flex-1 px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Create
            </button>
            <button
              onClick={() => {
                setShowNewProject(false);
                setNewProjectName('');
              }}
              className="flex-1 px-3 py-1.5 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
