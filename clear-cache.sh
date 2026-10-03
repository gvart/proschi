#!/bin/bash

# Clear Vite cache and restart dev server

echo "🧹 Clearing Vite cache..."
rm -rf frontend/node_modules/.vite
rm -rf frontend/dist

echo "✅ Cache cleared!"
echo ""
echo "Now run: cd frontend && npm run dev"
echo "Then hard refresh your browser (Ctrl+Shift+R or Cmd+Shift+R)"
