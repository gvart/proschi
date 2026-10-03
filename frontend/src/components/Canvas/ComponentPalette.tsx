import { useState } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import type { ComponentType, TechStack } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';
import { getTechStackIcon, categoryIcons } from '../../utils/iconMapping';
import { componentCatalog, type ComponentOption } from '../../catalog/componentCatalog';

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
