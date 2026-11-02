const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT_DIR = path.resolve(__dirname, '../..');

/**
 * Creates a static HTTP server to serve the local web files without external dependencies.
 */
function createStaticServer() {
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml'
    };

    const server = http.createServer((req, res) => {
        const cleanUrl = req.url.split('?')[0].split('#')[0];
        const relativePath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\//, '');
        const filePath = path.join(ROOT_DIR, relativePath);

        // Security check: ensure path is within ROOT_DIR
        if (!filePath.startsWith(ROOT_DIR)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, {
                'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                'Cache-Control': 'no-cache'
            });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });

    return new Promise((resolve) => {
        server.listen(0, () => {
            const port = server.address().port;
            resolve({
                port,
                url: `http://localhost:${port}`,
                close: () => new Promise(cb => {
                    if (typeof server.closeAllConnections === 'function') {
                        server.closeAllConnections();
                    }
                    server.close(cb);
                })
            });
        });
    });
}

/**
 * Launches the pre-installed Playwright Chromium instance.
 */
async function launchBrowser() {
    const defaultExecutable = path.join(
        process.env.LOCALAPPDATA || '',
        'ms-playwright',
        'chromium-1243',
        'chrome-win64',
        'chrome.exe'
    );

    const executablePath = fs.existsSync(defaultExecutable) ? defaultExecutable : undefined;

    const browser = await chromium.launch({
        executablePath,
        headless: true
    });

    return browser;
}

/**
 * Boots test environment: HTTP server, browser, and new page.
 */
async function setupTestEnvironment() {
    const server = await createStaticServer();
    const browser = await launchBrowser();
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    // Auto-dismiss alert dialogs so tests do not hang
    page.on('dialog', async dialog => {
        await dialog.dismiss();
    });

    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#editorCanvas');

    return {
        server,
        browser,
        context,
        page,
        async cleanup() {
            try {
                await page.close().catch(() => {});
                await context.close().catch(() => {});
                await browser.close().catch(() => {});
                await server.close().catch(() => {});
            } catch (err) {
                // Ignore cleanup errors
            }
        }
    };
}

module.exports = {
    createStaticServer,
    launchBrowser,
    setupTestEnvironment
};
