import { useState } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import type { ComponentType, TechStack } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';
import { getTechStackIcon, categoryIcons } from '../../utils/iconMapping';

interface ComponentOption {
  type: ComponentType;
  techStack: TechStack;
  category: string;
  searchTerms: string;
}

// Comprehensive component catalog
const componentCatalog: ComponentOption[] = [
  // Generic Shapes
  { type: 'shape', techStack: 'Rectangle', category: 'Generic Shapes', searchTerms: 'rectangle box square shape' },
  { type: 'shape', techStack: 'Circle', category: 'Generic Shapes', searchTerms: 'circle round shape' },
  { type: 'shape', techStack: 'Diamond', category: 'Generic Shapes', searchTerms: 'diamond rhombus shape decision' },
  { type: 'shape', techStack: 'Cylinder', category: 'Generic Shapes', searchTerms: 'cylinder shape storage' },
  { type: 'shape', techStack: 'Cloud', category: 'Generic Shapes', searchTerms: 'cloud shape' },
  { type: 'shape', techStack: 'Actor', category: 'Generic Shapes', searchTerms: 'actor user person human shape' },
  { type: 'shape', techStack: 'Note', category: 'Generic Shapes', searchTerms: 'note document comment annotation' },

  // Services
  { type: 'service', techStack: 'REST API', category: 'Services', searchTerms: 'rest api http service endpoint' },
  { type: 'service', techStack: 'GraphQL', category: 'Services', searchTerms: 'graphql api service query' },
  { type: 'service', techStack: 'gRPC', category: 'Services', searchTerms: 'grpc rpc service' },
  { type: 'service', techStack: 'WebSocket', category: 'Services', searchTerms: 'websocket ws realtime service' },
  { type: 'service', techStack: 'SOAP API', category: 'Services', searchTerms: 'soap api xml service' },

  // AWS Serverless
  { type: 'serverless', techStack: 'AWS Lambda', category: 'AWS Services', searchTerms: 'aws lambda serverless function' },
  { type: 'serverless', techStack: 'AWS API Gateway', category: 'AWS Services', searchTerms: 'aws api gateway rest' },

  // AWS Compute
  { type: 'compute', techStack: 'AWS EC2', category: 'AWS Services', searchTerms: 'aws ec2 compute instance vm' },
  { type: 'container', techStack: 'AWS ECS', category: 'AWS Services', searchTerms: 'aws ecs container docker' },
  { type: 'container', techStack: 'AWS EKS', category: 'AWS Services', searchTerms: 'aws eks kubernetes k8s' },
  { type: 'container', techStack: 'AWS Fargate', category: 'AWS Services', searchTerms: 'aws fargate serverless container' },

  // AWS Storage
  { type: 'storage', techStack: 'AWS S3', category: 'AWS Services', searchTerms: 'aws s3 storage bucket object' },
  { type: 'storage', techStack: 'AWS EBS', category: 'AWS Services', searchTerms: 'aws ebs storage volume disk' },
  { type: 'storage', techStack: 'AWS EFS', category: 'AWS Services', searchTerms: 'aws efs storage file system' },

  // AWS Database
  { type: 'database', techStack: 'AWS RDS', category: 'AWS Services', searchTerms: 'aws rds database relational sql' },
  { type: 'database', techStack: 'AWS DynamoDB', category: 'AWS Services', searchTerms: 'aws dynamodb database nosql' },
  { type: 'cache', techStack: 'AWS ElastiCache', category: 'AWS Services', searchTerms: 'aws elasticache redis memcached cache' },
  { type: 'database', techStack: 'AWS Aurora', category: 'AWS Services', searchTerms: 'aws aurora database mysql postgresql' },

  // AWS Messaging
  { type: 'queue', techStack: 'AWS SQS', category: 'AWS Services', searchTerms: 'aws sqs queue message' },
  { type: 'queue', techStack: 'AWS SNS', category: 'AWS Services', searchTerms: 'aws sns notification topic pubsub' },
  { type: 'queue', techStack: 'AWS EventBridge', category: 'AWS Services', searchTerms: 'aws eventbridge event bus' },
  { type: 'queue', techStack: 'AWS Kinesis', category: 'AWS Services', searchTerms: 'aws kinesis stream data' },

  // AWS CDN/Network
  { type: 'cdn', techStack: 'AWS CloudFront', category: 'AWS Services', searchTerms: 'aws cloudfront cdn edge' },
  { type: 'cdn', techStack: 'AWS Route53', category: 'AWS Services', searchTerms: 'aws route53 dns domain' },
  { type: 'cdn', techStack: 'AWS Load Balancer', category: 'AWS Services', searchTerms: 'aws alb elb load balancer' },

  // GCP Serverless
  { type: 'serverless', techStack: 'GCP Cloud Functions', category: 'GCP Services', searchTerms: 'gcp google cloud functions serverless' },
  { type: 'serverless', techStack: 'GCP Cloud Run', category: 'GCP Services', searchTerms: 'gcp google cloud run serverless container' },
  { type: 'serverless', techStack: 'GCP App Engine', category: 'GCP Services', searchTerms: 'gcp google app engine paas' },

  // GCP Compute
  { type: 'compute', techStack: 'GCP Compute Engine', category: 'GCP Services', searchTerms: 'gcp google compute engine vm instance' },
  { type: 'container', techStack: 'GCP GKE', category: 'GCP Services', searchTerms: 'gcp google gke kubernetes k8s' },

  // GCP Storage
  { type: 'storage', techStack: 'GCP Cloud Storage', category: 'GCP Services', searchTerms: 'gcp google cloud storage bucket object' },
  { type: 'storage', techStack: 'GCP Persistent Disk', category: 'GCP Services', searchTerms: 'gcp google persistent disk storage' },

  // GCP Database
  { type: 'database', techStack: 'GCP Cloud SQL', category: 'GCP Services', searchTerms: 'gcp google cloud sql database' },
  { type: 'database', techStack: 'GCP Firestore', category: 'GCP Services', searchTerms: 'gcp google firestore database nosql' },
  { type: 'database', techStack: 'GCP Bigtable', category: 'GCP Services', searchTerms: 'gcp google bigtable database nosql' },
  { type: 'database', techStack: 'GCP Spanner', category: 'GCP Services', searchTerms: 'gcp google spanner database sql' },
  { type: 'database', techStack: 'GCP BigQuery', category: 'GCP Services', searchTerms: 'gcp google bigquery data warehouse analytics' },

  // GCP Messaging
  { type: 'queue', techStack: 'GCP Pub/Sub', category: 'GCP Services', searchTerms: 'gcp google pubsub pub/sub message queue' },

  // GCP CDN/Network
  { type: 'cdn', techStack: 'GCP Cloud CDN', category: 'GCP Services', searchTerms: 'gcp google cloud cdn edge' },
  { type: 'cdn', techStack: 'GCP Cloud DNS', category: 'GCP Services', searchTerms: 'gcp google cloud dns domain' },
  { type: 'cdn', techStack: 'GCP Load Balancing', category: 'GCP Services', searchTerms: 'gcp google load balancing' },

  // Azure Serverless
  { type: 'serverless', techStack: 'Azure Functions', category: 'Azure Services', searchTerms: 'azure functions serverless' },
  { type: 'serverless', techStack: 'Azure Logic Apps', category: 'Azure Services', searchTerms: 'azure logic apps workflow' },
  { type: 'serverless', techStack: 'Azure API Management', category: 'Azure Services', searchTerms: 'azure api management gateway' },

  // Azure Compute
  { type: 'compute', techStack: 'Azure VM', category: 'Azure Services', searchTerms: 'azure vm virtual machine compute' },
  { type: 'container', techStack: 'Azure AKS', category: 'Azure Services', searchTerms: 'azure aks kubernetes k8s' },
  { type: 'container', techStack: 'Azure Container Instances', category: 'Azure Services', searchTerms: 'azure container instances aci' },

  // Azure Storage
  { type: 'storage', techStack: 'Azure Blob Storage', category: 'Azure Services', searchTerms: 'azure blob storage object' },
  { type: 'storage', techStack: 'Azure Files', category: 'Azure Services', searchTerms: 'azure files storage file system' },
  { type: 'storage', techStack: 'Azure Disk Storage', category: 'Azure Services', searchTerms: 'azure disk storage volume' },

  // Azure Database
  { type: 'database', techStack: 'Azure SQL', category: 'Azure Services', searchTerms: 'azure sql database' },
  { type: 'database', techStack: 'Azure Cosmos DB', category: 'Azure Services', searchTerms: 'azure cosmos db database nosql' },
  { type: 'database', techStack: 'Azure Database for PostgreSQL', category: 'Azure Services', searchTerms: 'azure postgresql database' },
  { type: 'database', techStack: 'Azure Database for MySQL', category: 'Azure Services', searchTerms: 'azure mysql database' },
  { type: 'cache', techStack: 'Azure Cache for Redis', category: 'Azure Services', searchTerms: 'azure redis cache' },

  // Azure Messaging
  { type: 'queue', techStack: 'Azure Service Bus', category: 'Azure Services', searchTerms: 'azure service bus queue message' },
  { type: 'queue', techStack: 'Azure Event Hubs', category: 'Azure Services', searchTerms: 'azure event hubs stream' },
  { type: 'queue', techStack: 'Azure Event Grid', category: 'Azure Services', searchTerms: 'azure event grid' },
  { type: 'queue', techStack: 'Azure Queue Storage', category: 'Azure Services', searchTerms: 'azure queue storage message' },

  // Azure CDN/Network
  { type: 'cdn', techStack: 'Azure CDN', category: 'Azure Services', searchTerms: 'azure cdn edge' },
  { type: 'cdn', techStack: 'Azure DNS', category: 'Azure Services', searchTerms: 'azure dns domain' },
  { type: 'cdn', techStack: 'Azure Front Door', category: 'Azure Services', searchTerms: 'azure front door cdn' },

  // Traditional Databases
  { type: 'database', techStack: 'PostgreSQL', category: 'Databases', searchTerms: 'postgresql postgres sql database' },
  { type: 'database', techStack: 'MySQL', category: 'Databases', searchTerms: 'mysql sql database' },
  { type: 'database', techStack: 'MongoDB', category: 'Databases', searchTerms: 'mongodb mongo nosql database' },
  { type: 'database', techStack: 'Redis', category: 'Databases', searchTerms: 'redis cache database key-value' },
  { type: 'database', techStack: 'DynamoDB', category: 'Databases', searchTerms: 'dynamodb nosql database aws' },
  { type: 'database', techStack: 'Cassandra', category: 'Databases', searchTerms: 'cassandra nosql database' },
  { type: 'database', techStack: 'CouchDB', category: 'Databases', searchTerms: 'couchdb nosql database' },
  { type: 'database', techStack: 'Elasticsearch', category: 'Databases', searchTerms: 'elasticsearch search database' },
  { type: 'database', techStack: 'Neo4j', category: 'Databases', searchTerms: 'neo4j graph database' },
  { type: 'database', techStack: 'InfluxDB', category: 'Databases', searchTerms: 'influxdb timeseries database' },
  { type: 'database', techStack: 'TimescaleDB', category: 'Databases', searchTerms: 'timescaledb timeseries postgresql database' },
  { type: 'database', techStack: 'MariaDB', category: 'Databases', searchTerms: 'mariadb mysql sql database' },
  { type: 'database', techStack: 'SQLite', category: 'Databases', searchTerms: 'sqlite sql database' },
  { type: 'database', techStack: 'Oracle', category: 'Databases', searchTerms: 'oracle sql database' },
  { type: 'database', techStack: 'SQL Server', category: 'Databases', searchTerms: 'sql server mssql database microsoft' },

  // Cache & In-Memory
  { type: 'cache', techStack: 'Memcached', category: 'Cache & In-Memory', searchTerms: 'memcached cache memory' },
  { type: 'cache', techStack: 'Hazelcast', category: 'Cache & In-Memory', searchTerms: 'hazelcast cache memory' },
  { type: 'cache', techStack: 'Aerospike', category: 'Cache & In-Memory', searchTerms: 'aerospike cache database' },

  // Message Queues
  { type: 'queue', techStack: 'Kafka', category: 'Message Queues', searchTerms: 'kafka message queue stream' },
  { type: 'queue', techStack: 'RabbitMQ', category: 'Message Queues', searchTerms: 'rabbitmq message queue amqp' },
  { type: 'queue', techStack: 'SQS', category: 'Message Queues', searchTerms: 'sqs queue aws message' },
  { type: 'queue', techStack: 'Redis Queue', category: 'Message Queues', searchTerms: 'redis queue message' },
  { type: 'queue', techStack: 'NATS', category: 'Message Queues', searchTerms: 'nats message queue' },
  { type: 'queue', techStack: 'Apache Pulsar', category: 'Message Queues', searchTerms: 'pulsar message queue stream' },
  { type: 'queue', techStack: 'ActiveMQ', category: 'Message Queues', searchTerms: 'activemq message queue' },
  { type: 'queue', techStack: 'ZeroMQ', category: 'Message Queues', searchTerms: 'zeromq zmq message queue' },

  // External Systems
  { type: 'external', techStack: 'Third Party API', category: 'External Systems', searchTerms: 'third party api external' },
  { type: 'external', techStack: 'Payment Gateway', category: 'External Systems', searchTerms: 'payment gateway stripe paypal' },
  { type: 'external', techStack: 'Auth Service', category: 'External Systems', searchTerms: 'auth authentication authorization' },
  { type: 'external', techStack: 'Email Service', category: 'External Systems', searchTerms: 'email service sendgrid mailgun' },
  { type: 'external', techStack: 'SMS Service', category: 'External Systems', searchTerms: 'sms service twilio' },
  { type: 'external', techStack: 'Analytics Service', category: 'External Systems', searchTerms: 'analytics service google analytics' },

  // Text & Annotations
  { type: 'text', techStack: 'Text Note', category: 'Annotations', searchTerms: 'text note annotation comment label' },
  { type: 'text', techStack: 'Sticky Note', category: 'Annotations', searchTerms: 'sticky note annotation comment' },
  { type: 'text', techStack: 'Comment', category: 'Annotations', searchTerms: 'comment annotation note text' },

  // Grouping
  { type: 'group', techStack: 'Logical Group', category: 'Grouping', searchTerms: 'group container boundary logical' },
  { type: 'group', techStack: 'Network Boundary', category: 'Grouping', searchTerms: 'group network boundary vpc subnet' },
  { type: 'group', techStack: 'Security Zone', category: 'Grouping', searchTerms: 'group security zone boundary' },
  { type: 'group', techStack: 'Service Group', category: 'Grouping', searchTerms: 'group service container boundary' },
];

export default function ComponentPalette() {
  const addNode = useCanvasStore((state) => state.addNode);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Filter components based on search query
  const filteredComponents = componentCatalog.filter((component) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      component.techStack.toLowerCase().includes(query) ||
      component.category.toLowerCase().includes(query) ||
      component.searchTerms.toLowerCase().includes(query)
    );
  });

  // Group by category
  const groupedComponents = filteredComponents.reduce(
    (acc, component) => {
      if (!acc[component.category]) {
        acc[component.category] = [];
      }
      acc[component.category].push(component);
      return acc;
    },
    {} as Record<string, ComponentOption[]>
  );

  const categories = Object.keys(groupedComponents).sort();

  const toggleCategory = (category: string) => {
    const newCollapsed = new Set(collapsedCategories);
    if (newCollapsed.has(category)) {
      newCollapsed.delete(category);
    } else {
      newCollapsed.add(category);
    }
    setCollapsedCategories(newCollapsed);
  };

  const handleAddComponent = (type: ComponentType, techStack: TechStack) => {
    addNode(type, techStack);
  };

  return (
    <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg w-80 max-h-[calc(100vh-2rem)] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Components</h3>

        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Component List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {categories.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No components found
          </div>
        ) : (
          categories.map((category) => {
            const isCollapsed = collapsedCategories.has(category);
            const components = groupedComponents[category];

            return (
              <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-gray-600">
                      {categoryIcons[category] || categoryIcons['Services']}
                    </div>
                    <span className="text-sm font-medium text-gray-700">{category}</span>
                    <span className="text-xs text-gray-500">({components.length})</span>
                  </div>
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  )}
                </button>

                {/* Category Items */}
                {!isCollapsed && (
                  <div className="p-2 bg-white">
                    <div className="grid grid-cols-2 gap-1">
                      {components.map((component) => (
                        <button
                          key={component.techStack}
                          onClick={() => handleAddComponent(component.type, component.techStack)}
                          className="flex items-center gap-2 px-2 py-2 text-xs bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded transition-all group"
                          title={`Add ${component.techStack}`}
                        >
                          <div className="text-gray-600 group-hover:text-blue-600 transition-colors flex-shrink-0">
                            {getTechStackIcon(component.techStack)}
                          </div>
                          <span className="text-gray-700 group-hover:text-blue-700 truncate text-left">
                            {component.techStack}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200 bg-gray-50">
        <p className="text-xs text-gray-500 text-center">
          {filteredComponents.length} component{filteredComponents.length !== 1 ? 's' : ''} available
        </p>
      </div>
    </div>
  );
}
