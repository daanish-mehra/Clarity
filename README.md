# Clarity

AI conversation tree with image-based context storage for 60-80% token cost savings.

## Features

- Branching conversation trees with visual graph
- Image-based context storage using Gemini Vision API
- Real-time token analytics and savings tracking
- Streaming AI responses
- Modern UI inspired by Gemini, Apple, Spotify, and Linear

## Setup

### Backend

1. Install dependencies:
```bash
cd ai_atl_2025-master
pip install -r requirements.txt
```

2. Set your Gemini API key:
```bash
export GEMINI_API_KEY='your-api-key-here'
```

3. Start the server:
```bash
./start_backend.sh
```

### Frontend

1. Install dependencies:
```bash
cd AI-ATL-Project-main
npm install
```

2. Start the dev server:
```bash
npm run dev
```

## Project Structure

- `ai_atl_2025-master/` - Python backend (FastAPI)
- `AI-ATL-Project-main/` - React/TypeScript frontend

## How It Works

Conversation history is converted to images and sent to Gemini's vision model instead of text tokens, resulting in 60-80% cost savings while maintaining full conversation context.

