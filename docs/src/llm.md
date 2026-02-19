# LLM & Agent Documentation

This site includes machine-readable documentation assets designed for Large Language Models (LLMs) and autonomous agents.

## Entry Points

- `[llms.txt](../llms.txt)`: A curated list of the most important documentation pages. Use this for a quick overview or initial context.
- `[llms-full.txt](../llms-full.txt)`: A complete list of all documentation pages in a hierarchical text format. Use this for exhaustive discovery.
- `[sitemap.xml](../sitemap.xml)`: A standard XML sitemap for web crawlers.

## Usage

Agents can read `llms.txt` to find relevant links without parsing the full HTML structure. The files are located at the root of the documentation site.

## Generation

These files are generated automatically during the build process using `scripts/generate-llms.ts`.

### Local Verification

To regenerate the assets locally:

1. Run the build command:
   ```bash
   bun run docs:build
   ```

2. Verify the files exist in the output directory (usually `docs/book`):
   - `docs/book/llms.txt`
   - `docs/book/llms-full.txt`
   - `docs/book/sitemap.xml`
   - `docs/book/robots.txt`

3. You can configure the base URL for the sitemap by setting the `DOCS_BASE_URL` environment variable:
   ```bash
   DOCS_BASE_URL=https://your-custom-domain.com bun run docs:build
   ```
