import { useState, useEffect } from 'react';
import { ArrowLeft, FolderOpen, Plus, Save, Network, PlayCircle } from 'lucide-react';
import { mockApi } from '../services/mockApi';
import { useCanvasStore } from '../store/canvasStore';
import type { Project } from '../types/canvas';

interface TopNavBarProps {
  onBackToProjects: () => void;
}

export default function TopNavBar({ onBackToProjects }: TopNavBarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const currentProject = useCanvasStore((state) => state.currentProject);
  const viewMode = useCanvasStore((state) => state.viewMode);
  const setViewMode = useCanvasStore((state) => state.setViewMode);
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
    if (projectId !== currentProject?.id) {
      await loadProject(projectId);
    }
  };

  const handleCreateProject = async () => {
    if (newProjectName.trim()) {
      const newProject = await mockApi.createProject(
        newProjectName.trim(),
        newProjectDescription.trim() || undefined
      );
      setProjects([...projects, newProject]);
      setNewProjectName('');
      setNewProjectDescription('');
      setShowNewProjectModal(false);
      await loadProject(newProject.id);
    }
  };

  const handleSave = async () => {
    await saveCanvas();
    alert('Canvas saved successfully!');
  };

  return (
    <>
      <div className="w-full h-16 bg-white border-b border-gray-200 shadow-sm flex items-center justify-between px-6 z-20">
        {/* Left Section - Back Button */}
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToProjects}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Projects</span>
          </button>

          <div className="h-8 w-px bg-gray-300" />

          {/* Project Selector */}
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg min-w-[250px]">
            <FolderOpen className="w-4 h-4 text-gray-600 flex-shrink-0" />
            <select
              value={currentProject?.id || ''}
              onChange={(e) => handleSelectProject(e.target.value)}
              className="flex-1 text-sm bg-transparent border-none focus:outline-none cursor-pointer"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="h-8 w-px bg-gray-300" />

          {/* Mode Selector */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('architecture')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
                viewMode === 'architecture'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Network className="w-4 h-4" />
              <span className="text-sm font-medium">Architecture</span>
            </button>
            <button
              onClick={() => setViewMode('usecases')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
                viewMode === 'usecases'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <PlayCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Use Cases</span>
            </button>
          </div>
        </div>

        {/* Right Section - Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewProjectModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
        </div>
      </div>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Create New Project</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                  placeholder="Enter project name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Enter project description"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Create Project
              </button>
              <button
                onClick={() => {
                  setShowNewProjectModal(false);
                  setNewProjectName('');
                  setNewProjectDescription('');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
