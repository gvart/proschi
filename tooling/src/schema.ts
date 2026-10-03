import type { ExecutionType, FlowStep, Protocol } from '../../frontend/src/services/api';
import type { ComponentType } from '../../frontend/src/types/canvas';
import { componentCatalog } from './proschi';

/**
 * JSON Schema for the output of `proschi parse`. It is generated (npm run
 * build writes schema/proschi-diagram.schema.json) so the tech stack list
 * comes straight from the catalog; schema.test.ts fails if the committed file
 * is stale or if the parser emits a field the schema does not describe.
 */

// Exhaustive records: adding a value to one of these unions without listing it here is a type error.
const PROTOCOLS: Record<Protocol, true> = { REST: true, GRPC: true, SOAP: true, GRAPHQL: true, MESSAGING: true, OTHER: true };
const EXECUTION: Record<ExecutionType, true> = { SYNC_REQUEST_RESPONSE: true, ASYNC_FIRE_AND_FORGET: true, ASYNC_REQUEST_RESPONSE: true };
const FORMATS: Record<FlowStep['requestFormat'], true> = { JSON: true, XML: true, FREE_TEXT: true };

const loc = { $ref: '#/$defs/loc' };
const str = { type: 'string' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const file = { type: 'string', description: 'The imported file this is in; left out for the parsed file itself.' };
const object = (properties: Record<string, unknown>, required: string[], description?: string) => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required,
  additionalProperties: false,
});

export function diagramSchema() {
  const componentTypes = [...new Set(componentCatalog.map((c) => c.type))] as ComponentType[];
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://gvart.github.io/proschi/schema/proschi-diagram.schema.json',
    title: 'Proschi parse result',
    description: 'Output of `proschi parse <file>`: the diagram a Proschi document describes, plus parser diagnostics.',
    ...object(
      {
        diagram: { $ref: '#/$defs/diagram' },
        diagnostics: { type: 'array', items: { $ref: '#/$defs/diagnostic' } },
        imports: { type: 'array', items: { $ref: '#/$defs/import' }, description: 'Every `import` statement read, in any file; left out when there are none.' },
      },
      ['diagram', 'diagnostics'],
    ),
    $defs: {
      loc: object(
        { line: { type: 'integer', minimum: 1 }, col: { type: 'integer', minimum: 1 }, length: { type: 'integer', minimum: 0 }, file },
        ['line', 'col', 'length'],
        '1-based source position.',
      ),
      diagnostic: object(
        {
          severity: { enum: ['error', 'warning'] },
          message: str,
          line: { type: 'integer', minimum: 1 },
          col: { type: 'integer', minimum: 1 },
          length: { type: 'integer', minimum: 0 },
          file,
        },
        ['severity', 'message', 'line', 'col', 'length'],
      ),
      import: object(
        { path: { ...str, description: 'The path as written.' }, resolved: { ...str, description: 'The file it resolved to; left out when it could not be found.' }, loc },
        ['path', 'loc'],
      ),
      diagram: object(
        {
          title: str,
          nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
          edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
          useCases: { type: 'array', items: { $ref: '#/$defs/useCase' } },
        },
        ['nodes', 'edges', 'useCases'],
      ),
      node: object(
        {
          id: str,
          kind: { enum: ['component', 'group', 'text'] },
          name: str,
          type: { enum: componentTypes },
          techStack: { enum: componentCatalog.map((c) => c.techStack) },
          ownerTeam: str,
          description: str,
          parent: { ...str, description: 'Id of the enclosing group.' },
          position: object({ x: { type: 'number' }, y: { type: 'number' } }, ['x', 'y'], 'Explicit `pos x,y`.'),
          implicit: { ...bool, description: 'Created because a connection or step referenced an undeclared id.' },
          loc,
        },
        ['id', 'kind', 'name', 'type', 'techStack', 'loc'],
      ),
      edge: object({ id: str, source: str, target: str, label: str, loc }, ['id', 'source', 'target', 'loc']),
      useCase: object(
        {
          id: str,
          name: str,
          description: str,
          entryServiceId: str,
          endpoint: { ...str, description: '`METHOD /path` of the first step, if it is an HTTP call.' },
          endpointGroup: { ...str, description: 'The endpoint with concrete ids folded into a `{param}` path template; use cases that share it hit the same endpoint.' },
          steps: { type: 'array', items: { $ref: '#/$defs/step' }, description: 'Steps of the first scenario.' },
          scenarios: { type: 'array', items: { $ref: '#/$defs/scenario' }, minItems: 1 },
          loc,
        },
        ['id', 'name', 'steps', 'scenarios', 'loc'],
      ),
      scenario: object(
        {
          id: str,
          name: str,
          outcome: { enum: ['success', 'error'] },
          condition: { ...str, description: "`when \"…\"` conditions of the branches on the scenario's path, joined with ' · '." },
          steps: { type: 'array', items: { $ref: '#/$defs/step' } },
          loc,
        },
        ['id', 'name', 'outcome', 'steps', 'loc'],
      ),
      step: object(
        {
          id: str,
          stepOrder: int,
          stepName: str,
          fromServiceId: str,
          toServiceId: str,
          protocol: { enum: Object.keys(PROTOCOLS) },
          httpMethod: str,
          endpoint: str,
          requestFormat: { enum: Object.keys(FORMATS) },
          requestBody: str,
          responseFormat: { enum: Object.keys(FORMATS) },
          responseBody: str,
          statusCode: int,
          description: str,
          executionType: { enum: Object.keys(EXECUTION) },
          parallelGroup: int,
          isParallel: bool,
          isConditional: bool,
          conditionExpression: str,
          failed: { ...bool, description: 'Written `a -x b`: the call never got an answer.' },
          loc: { ...loc, description: 'The request line.' },
          responseLoc: { ...loc, description: 'The `-->` line that answered the request.' },
        },
        ['stepOrder', 'stepName', 'fromServiceId', 'toServiceId', 'protocol', 'httpMethod', 'endpoint', 'requestFormat', 'responseFormat', 'executionType', 'isParallel', 'isConditional', 'loc'],
      ),
    },
  };
}
