import { useState, useEffect, useMemo, useRef } from 'react';
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
  ReactFlowProvider,
} from 'reactflow';
import type { Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import '@reactflow/node-resizer/dist/style.css';
import type { FlowStep } from '../../dsl/types';
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

const ERROR_COLOR = '#dc2626';

/** A step that failed outright or was answered with a 4xx/5xx status. */
function isErrorStep(step: FlowStep): boolean {
  return !!step.failed || (step.statusCode ?? 0) >= 400;
}

const connects = (edge: Edge, step: FlowStep) =>
  (edge.source === step.fromServiceId && edge.target === step.toServiceId) ||
  (edge.target === step.fromServiceId && edge.source === step.toServiceId);

interface UseCasePlayerProps {
  /** `condition` is the `when "…"` text of the scenario being played. */
  useCase: { id?: string; name: string; steps: FlowStep[]; condition?: string };
  nodes: Node[];
  edges: Edge[];
  onBack: () => void;
  /** 0-based step to open on, for links to a specific step. */
  initialStep?: number;
  onStepChange?: (index: number) => void;
  /** Hide the title bar when the host already shows the use case and a way back. */
  showHeader?: boolean;
}

/** Animated step-by-step playback of a use case over an architecture diagram. */
function UseCasePlayerContent({ useCase, nodes, edges: architectureEdges, onBack, initialStep, onStepChange, showHeader = true }: UseCasePlayerProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0);

  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);

  // Steps between nodes with no architecture edge get a hidden edge so they can still animate.
  const edges = useMemo(() => {
    const extra: Edge[] = [];
    for (const step of useCase.steps) {
      const connected = [...architectureEdges, ...extra].some(
        (e) =>
          (e.source === step.fromServiceId && e.target === step.toServiceId) ||
          (e.target === step.fromServiceId && e.source === step.toServiceId)
      );
      if (!connected && step.fromServiceId !== step.toServiceId) {
        extra.push({ id: `step:${step.fromServiceId}->${step.toServiceId}`, source: step.fromServiceId, target: step.toServiceId, data: { hiddenUntilActive: true } });
      }
    }
    return [...architectureEdges, ...extra];
  }, [useCase, architectureEdges]);

  // Restart when a different use case is played (not when the same one is edited);
  // only the first one honours initialStep.
  const useCaseKey = useCase.id ?? useCase.name;
  const firstUseCaseKeyRef = useRef(useCaseKey);
  useEffect(() => {
    const start = useCaseKey === firstUseCaseKeyRef.current ? (initialStep ?? 0) : 0;
    setCurrentStepIndex(Math.min(Math.max(start, 0), Math.max(useCase.steps.length - 1, 0)));
    setAnimationProgress(0);
    setIsPlaying(false);
    if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
    // initialStep only matters for the first use case; edits keep the current step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCaseKey]);

  // Editing can remove steps; stay within range.
  useEffect(() => {
    setCurrentStepIndex((index) => Math.min(index, Math.max(useCase.steps.length - 1, 0)));
  }, [useCase.steps.length]);

  useEffect(() => {
    onStepChange?.(currentStepIndex);
  }, [currentStepIndex, onStepChange]);

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
    };
  }, []);

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
        if (prev >= useCase.steps.length - 1) {
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

  // Manual steps animate too, so a failed call still shows where it was cut off.
  const handleStepForward = () => {
    handlePause();
    setCurrentStepIndex((prev) => Math.min(prev + 1, useCase.steps.length - 1));
    startAnimation();
  };

  const handleStepBack = () => {
    handlePause();
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
    startAnimation();
  };

  const handleReset = () => {
    handlePause();
    setCurrentStepIndex(0);
    setAnimationProgress(0);
  };

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

  // Get current step(s) - could be multiple for parallel execution
  const currentSteps = useCase.steps.filter((step, idx) => {
    if (idx > currentStepIndex) return false;
    if (idx === currentStepIndex) return true;
    // Include previous steps if they're in the same parallel group as current step
    const currentParallelGroup = useCase.steps[currentStepIndex]?.parallelGroup;
    return currentParallelGroup !== undefined && step.parallelGroup === currentParallelGroup;
  });

  // Get all highlighted nodes from current step(s)
  const highlightedNodes = new Set<string>();
  const errorNodes = new Set<string>();
  currentSteps.forEach(step => {
    highlightedNodes.add(step.fromServiceId);
    highlightedNodes.add(step.toServiceId);
    if (isErrorStep(step)) errorNodes.add(step.toServiceId);
  });

  // Nodes this scenario never touches fade further than the ones it passes through later.
  const scenarioNodes = new Set(useCase.steps.flatMap((step) => [step.fromServiceId, step.toServiceId]));

  // Apply highlighting to nodes
  const displayNodes: Node[] = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
    },
    style: {
      ...node.style,
      opacity: highlightedNodes.has(node.id) ? 1 : scenarioNodes.has(node.id) || node.type === 'groupNode' ? 0.45 : 0.15,
      transition: 'opacity 0.3s ease',
    },
    className: errorNodes.has(node.id)
      ? 'ring-4 ring-red-500 ring-opacity-60'
      : highlightedNodes.has(node.id)
        ? 'ring-4 ring-blue-500 ring-opacity-50'
        : '',
  }));

  // Find active edges for current step(s)
  const activeEdges = currentSteps.map(step => {
    const edge = edges.find((e) => connects(e, step));
    return edge ? { edge, step } : null;
  }).filter(Boolean);

  const displayEdges: Edge[] = edges.map((edge) => {
    const activeInfo = activeEdges.find(ae => ae?.edge.id === edge.id);
    const isActive = !!activeInfo;
    const step = activeInfo?.step;
    const isRequestResponse = step?.executionType === 'SYNC_REQUEST_RESPONSE' && !step.failed;
    const isError = !!step && isErrorStep(step);
    const onPath = useCase.steps.some((s) => connects(edge, s));

    return {
      ...edge,
      type: isActive ? 'animated' : 'default',
      animated: isActive && animationProgress >= 100 && !step?.failed,
      data: {
        ...(edge.data || {}),
        isActive,
        progress: animationProgress,
        isRequestResponse,
        isError,
        failed: !!step?.failed,
      },
      style: {
        ...edge.style,
        stroke: isActive ? (isError ? ERROR_COLOR : '#3b82f6') : '#b1b1b7',
        strokeWidth: isActive ? 3 : 2,
        strokeDasharray: isActive && step?.failed ? '6 4' : edge.style?.strokeDasharray,
        opacity: isActive ? 1 : edge.data?.hiddenUntilActive ? 0 : onPath ? 0.45 : 0.12,
        transition: 'all 0.3s ease',
      },
    };
  });

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      {showHeader && (
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
      )}

      {/* Canvas with Animation */}
      <div ref={reactFlowWrapperRef} className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
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
            className="!hidden md:!block"
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
      <div className="bg-white border-t border-gray-200 p-3 sm:p-4 max-h-[35vh] sm:max-h-64 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          {useCase.condition && (
            <p className="mb-2 text-sm text-gray-600">
              <span className="font-medium text-gray-700">When:</span> {useCase.condition}
            </p>
          )}
          {currentSteps.length > 1 && (
            <div className="mb-2 text-sm font-medium text-blue-600">
              ⚡ Parallel Execution ({currentSteps.length} steps running simultaneously)
            </div>
          )}
          {currentSteps.map((step, idx) => (
            <div key={step.id || idx} className="mb-4 last:mb-0">
              <div className="flex items-start gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${
                        isErrorStep(step) ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-600'
                      }`}
                    >
                      {useCase.steps.indexOf(step) + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-gray-900 break-words">{step.stepName}</h3>
                        {step.failed && (
                          <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">Failed</span>
                        )}
                        {!step.failed && (step.statusCode ?? 0) >= 400 && (
                          <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">{step.statusCode}</span>
                        )}
                        {step.executionType === 'SYNC_REQUEST_RESPONSE' && !step.failed && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">Sync</span>
                        )}
                        {step.executionType === 'ASYNC_FIRE_AND_FORGET' && (
                          <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">Fire & Forget</span>
                        )}
                        {step.executionType === 'ASYNC_REQUEST_RESPONSE' && (
                          <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">Async</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {nodes.find((n) => n.id === step.fromServiceId)?.data.name} →{' '}
                        {nodes.find((n) => n.id === step.toServiceId)?.data.name}
                      </p>
                    </div>
                    {`${step.httpMethod} ${step.endpoint}`.trim() !== step.stepName && (
                      <div className="text-sm text-gray-500 break-all">
                        {step.httpMethod} {step.endpoint}
                      </div>
                    )}
                  </div>

                  {step.description && (
                    <p className="text-sm text-gray-600 mb-3">{step.description}</p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {step.requestBody && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 mb-1">
                          Request ({step.requestFormat})
                        </div>
                        <pre className="text-xs bg-gray-50 p-2 rounded border border-gray-200 overflow-auto max-h-32">
                          {step.requestBody}
                        </pre>
                      </div>
                    )}
                    {step.responseBody && step.executionType !== 'ASYNC_FIRE_AND_FORGET' && (
                      <div>
                        <div className={`text-xs font-medium mb-1 ${isErrorStep(step) ? 'text-red-600' : 'text-gray-500'}`}>
                          Response ({step.responseFormat}){step.statusCode !== undefined && ` - ${step.statusCode}`}
                        </div>
                        <pre
                          className={`text-xs p-2 rounded border overflow-auto max-h-32 ${
                            isErrorStep(step) ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
                          }`}
                        >
                          {step.responseBody}
                        </pre>
                      </div>
                    )}
                    {!step.responseBody && !step.failed && (step.statusCode ?? 0) >= 400 && (
                      <div className="text-sm text-red-700">Answered with {step.statusCode}</div>
                    )}
                    {step.failed && (
                      <div className="text-sm text-red-700">No response: the call failed (timeout, connection refused or similar).</div>
                    )}
                  </div>
                </div>
              </div>
              {idx < currentSteps.length - 1 && <hr className="mt-4" />}
            </div>
          ))}
        </div>
      </div>

      {/* Playback Controls */}
      <div className="bg-white border-t border-gray-200 px-3 sm:px-6 py-3 sm:py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

export function UseCasePlayer(props: UseCasePlayerProps) {
  return (
    <ReactFlowProvider>
      <UseCasePlayerContent {...props} />
    </ReactFlowProvider>
  );
}
