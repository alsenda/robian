# AI Chat App

A lightweight AI chat application built with Preact and TanStack AI.

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

2. **Set your OpenAI API key**
   
   Create a `.env` file in the root directory:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

3. **Start the development server**
   
   In one terminal, start the Vite dev server:
   ```bash
   npm run dev
   ```
   
   In another terminal, start the API server:
   ```bash
   npm run dev:server
   ```

4. **Open the app**
   
   Navigate to `http://localhost:5173` (or the port shown by Vite)

## Architecture

- **Frontend**: Preact + TanStack AI Preact hooks
- **Backend**: Express server with TanStack AI OpenAI adapter
- **Styling**: Custom CSS with modern chat UI
- **Bundler**: Vite with esbuild

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
