#!/bin/bash
# Script to start the backend server with API key

# Check if API key is set
if [ -z "$GEMINI_API_KEY" ]; then
    echo "⚠️  GEMINI_API_KEY is not set!"
    echo ""
    echo "Please set it by running:"
    echo "  export GEMINI_API_KEY='your-api-key-here'"
    echo ""
    echo "Or add it to this script directly (line 8)"
    echo ""
    read -p "Do you want to enter your API key now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter your Gemini API key: " api_key
        export GEMINI_API_KEY="$api_key"
        echo "✅ API key set for this session"
    else
        echo "Exiting. Please set GEMINI_API_KEY and try again."
        exit 1
    fi
fi

echo "🚀 Starting backend server..."
echo "📍 Backend will be available at http://localhost:8000"
echo ""

python3 api_server.py

