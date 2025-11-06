import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import type { Node, Edge, ReactFlowInstance } from 'reactflow';
import 'reactflow/dist/style.css';
import '@reactflow/node-resizer/dist/style.css';
import { api, type UseCase } from '../../services/api';
import { useCanvasStore } from '../../store/canvasStore';
import ComponentNode from '../Canvas/ComponentNode';
import TextNode from '../Canvas/TextNode';
import GroupNode from '../Canvas/GroupNode';
import { AnimatedPlaybackEdge } from './AnimatedPlaybackEdge';

const nodeTypes = {
  componentNode: ComponentNode,
  textNode: TextNode,
  groupNode: GroupNode,
};

const edgeTypes = {
  animated: AnimatedPlaybackEdge,
};

interface UseCasePlaybackProps {
  useCaseId: string;
  onBack: () => void;
}

function UseCasePlaybackContent({ useCaseId, onBack }: UseCasePlaybackProps) {
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [tooltipData, setTooltipData] = useState<{
    x: number;
    y: number;
    content: React.ReactNode;
  } | null>(null);

  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const animationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reactFlowInstance = useReactFlow();
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadUseCase();
  }, [useCaseId]);

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
    };
  }, []);

  const loadUseCase = async () => {
    try {
      setLoading(true);
      const data = await api.getUseCase(useCaseId);
      setUseCase(data);
    } catch (error) {
      console.error('Failed to load use case:', error);
    } finally {
      setLoading(false);
    }
  };

  const startAnimation = () => {
    setAnimationProgress(0);
    if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);

    animationIntervalRef.current = setInterval(() => {
      setAnimationProgress((prev) => {
        if (prev >= 100) {
          if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
          return 100;
        }
        return prev + 2;
      });
    }, 30);
  };

  const handlePlay = () => {
    setIsPlaying(true);
    startAnimation();

    playIntervalRef.current = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (!useCase || prev >= useCase.steps.length - 1) {
          setIsPlaying(false);
          if (playIntervalRef.current) clearInterval(playIntervalRef.current);
          return prev;
        }
        startAnimation();
        return prev + 1;
      });
    }, 2000);
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
  };

  const handleStepForward = () => {
    if (!useCase) return;
    handlePause();
    setCurrentStepIndex((prev) => Math.min(prev + 1, useCase.steps.length - 1));
    setAnimationProgress(0);
  };

  const handleStepBack = () => {
    handlePause();
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
    setAnimationProgress(0);
  };

  const handleReset = () => {
    handlePause();
    setCurrentStepIndex(0);
    setAnimationProgress(0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading use case...</div>
      </div>
    );
  }

  if (!useCase) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Use case not found</div>
      </div>
    );
  }

  if (useCase.steps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full flex-col gap-4">
        <div className="text-gray-500">This use case has no steps to play</div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <ArrowLeft size={20} />
          Back to Use Cases
        </button>
      </div>
    );
  }

  const currentStep = useCase.steps[currentStepIndex];
  const highlightedNodes = new Set([currentStep.fromServiceId, currentStep.toServiceId]);

  // Apply highlighting to nodes
  const displayNodes: Node[] = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
    },
    style: {
      ...node.style,
      opacity: highlightedNodes.has(node.id) ? 1 : 0.3,
      transition: 'opacity 0.3s ease',
    },
    className: highlightedNodes.has(node.id)
      ? 'ring-4 ring-blue-500 ring-opacity-50'
      : '',
  }));

  // Highlight active edge
  const activeEdge = edges.find(
    (e) =>
      (e.source === currentStep.fromServiceId && e.target === currentStep.toServiceId) ||
      (e.target === currentStep.fromServiceId && e.source === currentStep.toServiceId)
  );

  const displayEdges: Edge[] = edges.map((edge) => ({
    ...edge,
    type: edge.id === activeEdge?.id ? 'animated' : 'default',
    animated: edge.id === activeEdge?.id && animationProgress >= 100,
    data: {
      ...(edge.data || {}),
      isActive: edge.id === activeEdge?.id,
      progress: animationProgress,
    },
    style: {
      ...edge.style,
      stroke: edge.id === activeEdge?.id ? '#3b82f6' : '#b1b1b7',
      strokeWidth: edge.id === activeEdge?.id ? 3 : 2,
      opacity: edge.id === activeEdge?.id ? 1 : 0.3,
      transition: 'all 0.3s ease',
    },
  }));

  // Get nodes for animation
  const fromNode = nodes.find((n) => n.id === currentStep.fromServiceId);
  const toNode = nodes.find((n) => n.id === currentStep.toServiceId);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{useCase.name}</h2>
              <p className="text-sm text-gray-500">Playback Mode - Read Only</p>
            </div>
          </div>
        </div>
      </div>

      {/* Canvas with Animation */}
      <div ref={reactFlowWrapperRef} className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          attributionPosition="bottom-left"
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          className="bg-gray-50"
          panOnDrag={true}
          zoomOnScroll={true}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(node) => {
              if (highlightedNodes.has(node.id)) {
                return '#3b82f6';
              }
              switch (node.data.type) {
                case 'service':
                  return '#3b82f6';
                case 'database':
                  return '#10b981';
                case 'queue':
                  return '#a855f7';
                case 'external':
                  return '#f97316';
                case 'text':
                  return '#eab308';
                case 'group':
                  return node.data.borderColor || '#3b82f6';
                default:
                  return '#6b7280';
              }
            }}
          />
        </ReactFlow>
      </div>

      {/* Step Info Panel */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-sm">
                  {currentStepIndex + 1}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{currentStep.stepName}</h3>
                  <p className="text-sm text-gray-500">
                    {nodes.find((n) => n.id === currentStep.fromServiceId)?.data.name} →{' '}
                    {nodes.find((n) => n.id === currentStep.toServiceId)?.data.name}
                  </p>
                </div>
                <div className="ml-auto text-sm text-gray-500">
                  {currentStep.httpMethod} {currentStep.endpoint}
                </div>
              </div>

              {currentStep.description && (
                <p className="text-sm text-gray-600 mb-3">{currentStep.description}</p>
              )}

              <div className="grid grid-cols-2 gap-4">
                {currentStep.requestBody && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">
                      Request ({currentStep.requestFormat})
                    </div>
                    <pre className="text-xs bg-gray-50 p-2 rounded border border-gray-200 overflow-auto max-h-32">
                      {currentStep.requestBody}
                    </pre>
                  </div>
                )}
                {currentStep.responseBody && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">
                      Response ({currentStep.responseFormat}) - {currentStep.statusCode}
                    </div>
                    <pre className="text-xs bg-gray-50 p-2 rounded border border-gray-200 overflow-auto max-h-32">
                      {currentStep.responseBody}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Playback Controls */}
      <div className="bg-white border-t border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Reset to start"
              >
                <SkipBack size={20} />
              </button>
              <button
                onClick={handleStepBack}
                disabled={currentStepIndex === 0}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous step"
              >
                <ChevronLeft size={20} />
              </button>
              {!isPlaying ? (
                <button
                  onClick={handlePlay}
                  className="p-3 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors"
                  title="Play"
                >
                  <Play size={24} />
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="p-3 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors"
                  title="Pause"
                >
                  <Pause size={24} />
                </button>
              )}
              <button
                onClick={handleStepForward}
                disabled={currentStepIndex === useCase.steps.length - 1}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next step"
              >
                <ChevronRight size={20} />
              </button>
              <button
                onClick={() => setCurrentStepIndex(useCase.steps.length - 1)}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Go to end"
              >
                <SkipForward size={20} />
              </button>
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700">
                  Step {currentStepIndex + 1} of {useCase.steps.length}
                </span>
                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{
                      width: `${((currentStepIndex + animationProgress / 100) / useCase.steps.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UseCasePlayback(props: UseCasePlaybackProps) {
  return (
    <ReactFlowProvider>
      <UseCasePlaybackContent {...props} />
    </ReactFlowProvider>
  );
}
