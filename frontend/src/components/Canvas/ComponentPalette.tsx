import { Server, Database, MessageSquare, ExternalLink } from 'lucide-react';
import type { ComponentType, TechStack } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';

interface ComponentOption {
  type: ComponentType;
  label: string;
  icon: React.ReactNode;
  color: string;
  techStacks: TechStack[];
}

const componentOptions: ComponentOption[] = [
  {
    type: 'service',
    label: 'Service',
    icon: <Server className="w-5 h-5" />,
    color: 'bg-blue-500',
    techStacks: ['REST API', 'GraphQL', 'gRPC', 'WebSocket'],
  },
  {
    type: 'database',
    label: 'Database',
    icon: <Database className="w-5 h-5" />,
    color: 'bg-green-500',
    techStacks: ['PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'DynamoDB'],
  },
  {
    type: 'queue',
    label: 'Message Queue',
    icon: <MessageSquare className="w-5 h-5" />,
    color: 'bg-purple-500',
    techStacks: ['Kafka', 'RabbitMQ', 'SQS', 'Redis Queue'],
  },
  {
    type: 'external',
    label: 'External System',
    icon: <ExternalLink className="w-5 h-5" />,
    color: 'bg-orange-500',
    techStacks: ['Third Party API', 'Payment Gateway', 'Auth Service'],
  },
];

export default function ComponentPalette() {
  const addNode = useCanvasStore((state) => state.addNode);

  const handleAddComponent = (type: ComponentType, techStack: TechStack) => {
    addNode(type, techStack);
  };

  return (
    <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-4 w-64">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Components</h3>

      <div className="space-y-3">
        {componentOptions.map((option) => (
          <div key={option.type} className="border-b border-gray-200 pb-3 last:border-b-0">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded ${option.color} text-white`}>
                {option.icon}
              </div>
              <span className="text-sm font-medium text-gray-700">{option.label}</span>
            </div>

            <div className="flex flex-wrap gap-1 ml-8">
              {option.techStacks.map((techStack) => (
                <button
                  key={techStack}
                  onClick={() => handleAddComponent(option.type, techStack)}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
                >
                  {techStack}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Click a technology to add it to the canvas
        </p>
      </div>
    </div>
  );
}
