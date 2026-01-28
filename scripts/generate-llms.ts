import * as fs from 'fs';
import * as path from 'path';

// Configuration
const DOCS_DIR = path.join(process.cwd(), 'docs');
const SUMMARY_PATH = path.join(DOCS_DIR, 'src', 'SUMMARY.md');
const BOOK_TOML_PATH = path.join(DOCS_DIR, 'book.toml');

// Parse environment variable for base URL, default to GitHub Pages or placeholdler
const DOCS_BASE_URL = process.env.DOCS_BASE_URL || 'https://matter-labs.github.io/zksync-js';

// Function to read book.toml and find the output directory
function getOutputDir(): string {
    try {
        const content = fs.readFileSync(BOOK_TOML_PATH, 'utf-8');
        const match = content.match(/build-dir\s*=\s*"([^"]+)"/);
        if (match && match[1]) {
            // If the path is relative, it's relative to the docs directory where book.toml is
            return path.join(DOCS_DIR, match[1]);
        }
    } catch (error) {
        console.warn('Could not read book.toml, defaulting to docs/book');
    }
    return path.join(DOCS_DIR, 'book');
}

const OUTPUT_DIR = getOutputDir();

// Helper to ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface Page {
    title: string;
    path?: string; // Optional because some items are just section headers
    level: number;
}

// Function to parse SUMMARY.md
function parseSummary(): Page[] {
    if (!fs.existsSync(SUMMARY_PATH)) {
        console.error(`Error: SUMMARY.md not found at ${SUMMARY_PATH}`);
        process.exit(1);
    }

    const content = fs.readFileSync(SUMMARY_PATH, 'utf-8');
    const lines = content.split('\n');
    const pages: Page[] = [];

    for (const line of lines) {
        // Check for links: "- [Title](path/to/file.md)" or "  - [Title](...)"
        const linkMatch = line.match(/^(\s*)-\s*\[([^\]]+)\]\(([^)]*)\)/);

        // Check for section headers (no link): "- Title" or "  - Title" or "# Title" (top level)
        // Note: SUMMARY.md usually uses links for everything, but sometimes sections are just groupings.
        // We'll focus on the markdown list structure.

        if (linkMatch) {
            const indentation = linkMatch[1].length;
            const title = linkMatch[2];
            let filePath = linkMatch[3];

            // Clean up path
            if (!filePath || filePath.startsWith('http')) {
                // External link or empty, treat as section header if meaningful, or skip
                if (!filePath) {
                    // Section header defined as a link without target? Unusual but possible.
                    const level = indentation / 2;
                    pages.push({ title, level });
                }
                continue;
            }

            // Handle relative paths and anchors
            // Remove anchors
            filePath = filePath.split('#')[0];

            if (!filePath) continue; // Was just an anchor

            // mdBook changes .md to .html in the output
            filePath = filePath.replace(/\.md$/, '.html');

            // Calculate level based on indentation (assuming 2 spaces per level)
            const level = indentation / 2;

            pages.push({ title, path: filePath, level });
        } else {
            // Try mapping simple list items as headers if they don't look like links
            const listMatch = line.match(/^(\s*)-\s*(.+)/);
            if (listMatch) {
                // Check it's not a link variant we missed
                if (!listMatch[2].startsWith('[')) {
                    const indentation = listMatch[1].length;
                    const title = listMatch[2];
                    const level = indentation / 2;
                    pages.push({ title, level });
                }
            }
        }
    }
    return pages;
}

const allPages = parseSummary();
console.log(`Discovered ${allPages.length} items in SUMMARY.md`);

// 1. Generate llms.txt (Curated Instructional Entry Point)
function generateLlmsTxt() {
    const curatedPages = allPages.filter(p =>
        p.path && (
            p.path.startsWith('overview/') ||
            p.path.startsWith('quickstart/') ||
            p.path.includes('api') ||
            p.path.startsWith('sdk-reference/')
        )
    );

    let content = `# ZKsync JS SDK Documentation

## Purpose
The ZKsync JS SDK provides a set of TypeScript libraries for interacting with the ZKsync Era Layer 2 network. It enables developers to perform transactions, deploy contracts, and manage accounts on ZKsync Era, leveraging the scalability and low fees of the ZK rollup technology.

## Intended Audience
This documentation is for blockchain developers, dApp builders, and integrators who want to interact with ZKsync Era using JavaScript/TypeScript. It assumes familiarity with Ethereum concepts and Ethers.js or Viem.

## Recommended Reading Order
1. **Overview**: Understand the mental model and how the SDK fits in.
2. **Quickstart**: Get your environment set up and run your first interaction.
3. **Concepts**: Deep dive into specific features like Account Abstraction.
4. **SDK Reference**: Detailed API documentation for Ethers and Viem adapters.

## Important Pages

`;

    // We want to list these somewhat intelligently, but preserving their order from SUMMARY is usually best 
    // as it follows the author's intended narrative.

    // Dedup paths just in case
    const seen = new Set<string>();

    for (const page of curatedPages) {
        if (!page.path) continue;
        if (seen.has(page.path)) continue;
        seen.add(page.path);

        // Make link relative to root
        content += `- [${page.title}](${page.path})\n`;
    }

    content += `\n> **Note**: For a complete, hierarchical list of all documentation pages, see [llms-full.txt](llms-full.txt).\n`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'llms.txt'), content);
    console.log(`Generated llms.txt with ${seen.size} links`);
}

// 2. Generate llms-full.txt (Hierarchical Full List)
function generateLlmsFullTxt() {
    let content = `# ZKsync SDK Documentation - Full Index\n\n`;
    content += `> This file mirrors the structure of the documentation side bar.\n\n`;

    for (const page of allPages) {
        // Create markdown headers for top-level sections to add structure
        if (page.level === 0) {
            content += `\n## ${page.title}\n`;
            if (page.path) {
                content += `- [${page.title}](${page.path})\n`;
            }
        } else {
            const indent = "  ".repeat(page.level - 1); // Indent relative to previous level
            if (page.path) {
                content += `${indent}- [${page.title}](${page.path})\n`;
            } else {
                // It's a group header
                content += `${indent}- **${page.title}**\n`;
            }
        }
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'llms-full.txt'), content);
    console.log('Generated llms-full.txt');
}

// 3. Generate sitemap.xml
function generateSitemap() {
    let content = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    content += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    const seen = new Set<string>();

    for (const page of allPages) {
        if (!page.path) continue;
        if (seen.has(page.path)) continue;
        seen.add(page.path);

        // Normalizing path. ensuring no leading slash if we join with base
        const urlPath = page.path.startsWith('/') ? page.path.substring(1) : page.path;
        const loc = `${DOCS_BASE_URL.replace(/\/$/, '')}/${urlPath}`;

        content += `  <url>\n`;
        content += `    <loc>${loc}</loc>\n`;
        content += `    <changefreq>weekly</changefreq>\n`;
        content += `  </url>\n`;
    }

    content += `</urlset>`;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), content);
    console.log(`Generated sitemap.xml with ${seen.size} URLs`);
}

// 4. Update robots.txt
function updateRobotsTxt() {
    const robotsPath = path.join(OUTPUT_DIR, 'robots.txt');
    let content = "";

    if (fs.existsSync(robotsPath)) {
        content = fs.readFileSync(robotsPath, 'utf-8');
        // Ensure we don't duplicate our additions if re-running
        if (content.includes('# Generated by zksync-js LLM script')) {
            // If we previously generated it, we can overwrite or just leave it.
            // For robustness, let's keep existing custom rules and simple append if missing.
            // But if we want to enforce correctly, better to check key rules.
        }
    }

    // Define our rules block
    const ourRules = [
        "# Generated by zksync-js LLM script",
        "User-agent: *",
        "Allow: /"
    ];

    if (process.env.DOCS_BASE_URL) {
        ourRules.push(`Sitemap: ${process.env.DOCS_BASE_URL.replace(/\/$/, '')}/sitemap.xml`);
    } else {
        // If no env var, use default but mark as such or omit if strictly required to be env-aware? 
        // User requirement: "Include Sitemap only when a valid DOCS_BASE_URL is configured"
        // BUT also "Provide a safe default for GitHub Pages" for the sitemap content itself.
        // So strictly speaking, `DOCS_BASE_URL` const above HAS a default.
        // We will use that const.
        ourRules.push(`Sitemap: ${DOCS_BASE_URL.replace(/\/$/, '')}/sitemap.xml`);
    }

    const ourRulesBlock = ourRules.join('\n');

    // If file exists, we want to ensure Allow: / is present and Sitemap is present.
    if (content) {
        if (!content.includes("Allow: /")) {
            content += "\nUser-agent: *\nAllow: /\n";
        }
        if (!content.includes("Sitemap:")) {
            content += `\nSitemap: ${DOCS_BASE_URL.replace(/\/$/, '')}/sitemap.xml\n`;
        }
        // If it exists, just write back the modifications
        fs.writeFileSync(robotsPath, content);
    } else {
        // New file
        fs.writeFileSync(robotsPath, ourRulesBlock + '\n');
    }

    console.log('Updated robots.txt');
}

// Main execution
console.log(`Generating LLM assets in ${OUTPUT_DIR}...`);
try {
    generateLlmsTxt();
    generateLlmsFullTxt();
    generateSitemap();
    updateRobotsTxt();
    console.log('Done.');
} catch (e) {
    console.error('Error generating LLM assets:', e);
    process.exit(1);
}
