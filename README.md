# Robian

A lightweight local Ollama chat app (Robian) built with Preact and TanStack AI.

## Features

- 🤖 AI-powered chat using TanStack AI
- ⚡ Built with Preact for minimal bundle size
- 🎨 Clean, modern chat interface
- 🔄 Real-time streaming responses
- 🚀 Fast development with Vite

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure Ollama (required)**

   This app uses a locally running Ollama server.

   Install Ollama, then create the Robian model from the included `Modelfile`:

   ```bash
   # Ensure the base model exists (used by Modelfile: FROM llama3.2)
   ollama pull llama3.2

   # Create the custom model in this repo
   ollama create robian -f Modelfile
   ```

   Start Ollama (if it isn't already running), and optionally sanity-check:

   ```bash
   ollama run robian "Say hi"
   ```

   Optional: create a `.env` file in the root directory:
   ```
   OLLAMA_URL=http://localhost:11434
   OLLAMA_MODEL=robian:latest
   ```

## RAG (Local Documents)

This repo includes a fully local RAG pipeline:
SQLite + sqlite-vec storage, PDF/text extraction, normalize + chunking, Ollama embeddings, and an async ingest queue.

### Environment variables

Required/commonly used:

```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_CHAT_MODEL=robian:latest
RAG_EMBED_BATCH_SIZE=32
```

Notes:
- `OLLAMA_BASE_URL` is used by the RAG embedding + ask pipeline.
- `OLLAMA_URL` / `OLLAMA_MODEL` are still used by the existing `/api/chat` endpoint; you can point both base URLs to the same local Ollama instance.

### Ingest endpoints

- `POST /api/rag/ingest/:documentId` (enqueue indexing job)
- `GET /api/rag/ingest/jobs/:jobId` (poll job status)

Example:

```bash
curl -s -X POST "http://localhost:3001/api/rag/ingest/<documentId>" \
   -H "Content-Type: application/json" \
   -d '{"userId":"local"}'
```

```bash
curl -s "http://localhost:3001/api/rag/ingest/jobs/<jobId>"
```

### Ask endpoint

- `POST /api/rag/ask`

Body:

```json
{ "userId": "local", "question": "...", "topK": 8, "documentIds": ["..."] }
```

Example:

```bash
curl -s -X POST "http://localhost:3001/api/rag/ask" \
   -H "Content-Type: application/json" \
   -d '{"userId":"local","question":"What does the document say about X?"}'
```

3. **Configure web search (optional)**

   The `search_web` tool is enabled by default and uses DuckDuckGo HTML (no API key).

   To switch providers, set:
   ```
   WEB_SEARCH_PROVIDER=duckduckgo
   ```

   Or to use Brave Search instead:
   ```
   WEB_SEARCH_PROVIDER=brave
   BRAVE_SEARCH_API_KEY=your_key_here
   ```

4. **Start the development server**
   
   In one terminal, start the Vite dev server:
   ```bash
   npm run dev
   ```
   
   In another terminal, start the API server:
   ```bash
   npm run dev:server
   ```

5. **Open the app**
   
   Navigate to `http://localhost:5173` (or the port shown by Vite)

## Architecture

- **Frontend**: Preact + TanStack AI Preact hooks
- **Backend**: Express server that streams from local Ollama (`/api/chat`)
- **Styling**: Tailwind CSS (v4)
- **Bundler**: Vite with esbuild

## Running in production (single server)

The API server can also serve the built frontend (including Tailwind CSS).

```bash
npm run build
NODE_ENV=production npm run dev:server
```

Then open `http://localhost:3001`.

## Scripts

- `npm run dev` - Start Vite development server
- `npm run dev:server` - Start API server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Package Size

Total dependencies: ~34 MB (optimized with Preact and direct esbuild usage)
- Removed React in favor of Preact (~3MB saved)
- Removed Babel in favor of esbuild (~8MB saved)

## License

MIT
