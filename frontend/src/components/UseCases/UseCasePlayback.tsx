import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
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
import { FIT_VIEW_OPTIONS } from '../Diagram/useFitOnChange';
import { CANVAS_ACCENT, CANVAS_EDGE, CANVAS_FAIL, CANVAS_INK } from '../../utils/canvasColors';
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

const ERROR_COLOR = CANVAS_FAIL;

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
  /**
   * Plays while true: from the moment it opens (e.g. after a Play button outside
   * it was pressed), and again whenever it turns true; pauses when it turns false.
   */
  autoPlay?: boolean;
  /** Called once playback reaches the end of the last step (not when looping). */
  onFinished?: () => void;
  /** Start over from the first step after the last one, instead of stopping. */
  loop?: boolean;
  /**
   * Just the canvas: no step panel, controls or minimap, and no pan or zoom,
   * for an embedded preview whose host shows its own captions.
   */
  bare?: boolean;
}

/** How long each step is shown while playing. */
const STEP_MS = 2000;

/** Animated step-by-step playback of a use case over an architecture diagram. */
function UseCasePlayerContent({
  useCase,
  nodes,
  edges: architectureEdges,
  onBack,
  initialStep,
  onStepChange,
  showHeader = true,
  autoPlay = false,
  onFinished,
  loop = false,
  bare = false,
}: UseCasePlayerProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0);

  const animationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);

  // The packet's progress along the current edge, 0–100; resuming keeps where it was.
  const resumeAnimation = useCallback(() => {
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
  }, []);

  const startAnimation = useCallback(() => {
    setAnimationProgress(0);
    resumeAnimation();
  }, [resumeAnimation]);

  const onFinishedRef = useRef(onFinished);
  const autoPlayRef = useRef(autoPlay);
  useEffect(() => {
    onFinishedRef.current = onFinished;
    autoPlayRef.current = autoPlay;
  });

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
    const play = autoPlayRef.current && useCase.steps.length > 0;
    setIsPlaying(play);
    if (play) startAnimation();
    else if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
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
      if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
    };
  }, []);

  // While playing, move on one step every STEP_MS; at the end stop (or loop).
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setTimeout(() => {
      if (currentStepIndex < useCase.steps.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
        startAnimation();
      } else if (loop) {
        setCurrentStepIndex(0);
        startAnimation();
      } else {
        setIsPlaying(false);
        onFinishedRef.current?.();
      }
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [isPlaying, currentStepIndex, useCase.steps.length, loop, startAnimation]);

  const handlePlay = () => {
    setIsPlaying(true);
    startAnimation();
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
  };

  // `autoPlay` follows its host: playing while true, paused when it turns false.
  const autoPlayedRef = useRef(autoPlay);
  useEffect(() => {
    if (autoPlay === autoPlayedRef.current) return;
    autoPlayedRef.current = autoPlay;
    if (autoPlay) {
      // Resume where it was paused, mid-step if the packet was on its way.
      setIsPlaying(true);
      if (animationProgress < 100) resumeAnimation();
    } else {
      handlePause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

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
        <div className="text-muted">This use case has no steps to play</div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 bg-pop-yellow text-on-accent font-semibold border-bw-1 border-ink shadow-brutal-sm rounded-lg hover:bg-pop-yellow/85 transition-colors"
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
    // Styled in Canvas/canvas.css: one accent for the step's nodes, red for the one that failed.
    className: errorNodes.has(node.id) ? 'pc-failing' : highlightedNodes.has(node.id) ? 'pc-active' : '',
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
        // The line is ink; the packet riding it (AnimatedPlaybackEdge) carries the accent.
        stroke: isActive ? (isError ? ERROR_COLOR : CANVAS_INK) : CANVAS_EDGE,
        strokeWidth: isActive ? 3 : 2,
        strokeDasharray: isActive && step?.failed ? '6 4' : edge.style?.strokeDasharray,
        opacity: isActive ? 1 : edge.data?.hiddenUntilActive ? 0 : onPath ? 0.45 : 0.12,
        transition: 'all 0.3s ease',
      },
    };
  });

  return (
    <div className={`h-full flex flex-col ${bare ? '' : 'bg-paper'}`}>
      {/* Header */}
      {showHeader && !bare && (
      <div className="bg-surface border-b border-ink/15 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 text-ink/75 hover:bg-ink/10 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-2xl font-bold text-ink">{useCase.name}</h2>
              <p className="text-sm text-muted">Playback Mode - Read Only</p>
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
          fitViewOptions={FIT_VIEW_OPTIONS}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          className={bare ? '' : 'bg-paper'}
          panOnDrag={!bare}
          zoomOnScroll={!bare}
          zoomOnPinch={!bare}
          zoomOnDoubleClick={!bare}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          {!bare && <Controls showInteractive={false} />}
          {!bare && <MiniMap
            className="!hidden md:!block"
            nodeColor={(node) => (errorNodes.has(node.id) ? CANVAS_FAIL : highlightedNodes.has(node.id) ? CANVAS_ACCENT : CANVAS_EDGE)}
            maskColor="rgb(var(--c-paper) / 0.6)"
          />}
        </ReactFlow>
      </div>

      {!bare && <>
      {/* Step Info Panel */}
      <div className="bg-surface border-t border-ink/15 p-3 sm:p-4 max-h-[35vh] sm:max-h-64 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          {useCase.condition && (
            <p className="mb-2 text-sm text-ink/75">
              <span className="font-medium text-ink/85">When:</span> {useCase.condition}
            </p>
          )}
          {currentSteps.length > 1 && (
            <div className="mb-2 text-sm font-medium text-pop-blue">
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
                        isErrorStep(step) ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-pop-blue/15 text-pop-blue'
                      }`}
                    >
                      {useCase.steps.indexOf(step) + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-ink break-words">{step.stepName}</h3>
                        {step.failed && (
                          <span className="px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded">Failed</span>
                        )}
                        {!step.failed && (step.statusCode ?? 0) >= 400 && (
                          <span className="px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded">{step.statusCode}</span>
                        )}
                        {step.executionType === 'SYNC_REQUEST_RESPONSE' && !step.failed && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">Sync</span>
                        )}
                        {step.executionType === 'ASYNC_FIRE_AND_FORGET' && (
                          <span className="px-2 py-0.5 text-xs bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded">Fire & Forget</span>
                        )}
                        {step.executionType === 'ASYNC_REQUEST_RESPONSE' && (
                          <span className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded">Async</span>
                        )}
                      </div>
                      <p className="text-sm text-muted">
                        {nodes.find((n) => n.id === step.fromServiceId)?.data.name} →{' '}
                        {nodes.find((n) => n.id === step.toServiceId)?.data.name}
                      </p>
                    </div>
                    {`${step.httpMethod} ${step.endpoint}`.trim() !== step.stepName && (
                      <div className="text-sm text-muted break-all">
                        {step.httpMethod} {step.endpoint}
                      </div>
                    )}
                  </div>

                  {step.description && (
                    <p className="text-sm text-ink/75 mb-3">{step.description}</p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {step.requestBody && (
                      <div>
                        <div className="text-xs font-medium text-muted mb-1">
                          Request ({step.requestFormat})
                        </div>
                        <pre className="text-xs bg-paper p-2 rounded border border-ink/15 overflow-auto max-h-32">
                          {step.requestBody}
                        </pre>
                      </div>
                    )}
                    {step.responseBody && step.executionType !== 'ASYNC_FIRE_AND_FORGET' && (
                      <div>
                        <div className={`text-xs font-medium mb-1 ${isErrorStep(step) ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}>
                          Response ({step.responseFormat}){step.statusCode !== undefined && ` - ${step.statusCode}`}
                        </div>
                        <pre
                          className={`text-xs p-2 rounded border overflow-auto max-h-32 ${
                            isErrorStep(step) ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' : 'bg-paper border-ink/15'
                          }`}
                        >
                          {step.responseBody}
                        </pre>
                      </div>
                    )}
                    {!step.responseBody && !step.failed && (step.statusCode ?? 0) >= 400 && (
                      <div className="text-sm text-red-700 dark:text-red-300">Answered with {step.statusCode}</div>
                    )}
                    {step.failed && (
                      <div className="text-sm text-red-700 dark:text-red-300">No response: the call failed (timeout, connection refused or similar).</div>
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
      <div className="bg-surface border-t border-ink/15 px-3 sm:px-6 py-3 sm:py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                className="p-2 text-ink/75 hover:bg-ink/10 rounded-lg transition-colors"
                title="Reset to start"
              >
                <SkipBack size={20} />
              </button>
              <button
                onClick={handleStepBack}
                disabled={currentStepIndex === 0}
                className="p-2 text-ink/75 hover:bg-ink/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous step"
              >
                <ChevronLeft size={20} />
              </button>
              {!isPlaying ? (
                <button
                  onClick={handlePlay}
                  className="p-3 bg-pop-yellow text-on-accent font-semibold border-bw-1 border-ink shadow-brutal-sm hover:bg-pop-yellow/85 rounded-lg transition-colors"
                  title="Play"
                >
                  <Play size={24} />
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="p-3 bg-pop-yellow text-on-accent font-semibold border-bw-1 border-ink shadow-brutal-sm hover:bg-pop-yellow/85 rounded-lg transition-colors"
                  title="Pause"
                >
                  <Pause size={24} />
                </button>
              )}
              <button
                onClick={handleStepForward}
                disabled={currentStepIndex === useCase.steps.length - 1}
                className="p-2 text-ink/75 hover:bg-ink/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next step"
              >
                <ChevronRight size={20} />
              </button>
              <button
                onClick={() => setCurrentStepIndex(useCase.steps.length - 1)}
                className="p-2 text-ink/75 hover:bg-ink/10 rounded-lg transition-colors"
                title="Go to end"
              >
                <SkipForward size={20} />
              </button>
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-ink/85">
                  Step {currentStepIndex + 1} of {useCase.steps.length}
                </span>
                <div className="flex-1 h-2 bg-ink/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-pop-yellow transition-all duration-300"
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
      </>}
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
