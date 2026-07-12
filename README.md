# CourseFoundry

Video-native adaptive learning platform.

## Docker Setup

1. Copy environment defaults (first run only):

   ```bash
   cp .env.example .env
   ```

2. Add your `OPENAI_API_KEY` to `.env`.

3. Start the full local stack:

   ```bash
   docker compose up --build
   ```

Open the app at `http://localhost:3000`. The pipeline health endpoint is
`http://localhost:8000/health`.

JavaScript and Python dependency installation is only required for running tests or
development tools directly on the host:

```bash
npm install
cd pipeline
uv sync --extra dev --python 3.12
cd ..
```

Verify service health after installing the host dependencies:

```bash
npm run test:health
```

## Architecture Decisions

Confirmed decisions are tracked in `implementation.md`.
