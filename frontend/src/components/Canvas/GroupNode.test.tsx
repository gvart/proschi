// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from 'reactflow';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentMetadata } from '../../types/canvas';
import GroupNode from './GroupNode';

afterEach(cleanup);

const props = {
  id: 'services',
  data: { id: 'services', name: 'Service Layer' },
  selected: false,
} as unknown as NodeProps<ComponentMetadata>;

describe('GroupNode', () => {
  // React Flow draws no edge whose end node has no handle of the right type,
  // so `gw -> services` (a group) would silently vanish from the canvas.
  it('has a source and a target handle so connections to and from a group are drawn', () => {
    const { container } = render(
      <ReactFlowProvider>
        <GroupNode {...props} />
      </ReactFlowProvider>,
    );
    expect(container.querySelectorAll('.react-flow__handle.source')).toHaveLength(1);
    expect(container.querySelectorAll('.react-flow__handle.target')).toHaveLength(1);
  });
});
