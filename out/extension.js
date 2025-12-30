const vscode = require('vscode');

/**
 * TAP Folding Provider
 * Provides syntax-aware folding for TAP files based on test plans and subtests
 */
class TapFoldingProvider {
    provideFoldingRanges(document, context, token) {
        const foldingRanges = [];
        const lines = document.getText().split('\n');
        const stack = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            const indentation = line.length - line.trimStart().length;

            const planMatch = trimmedLine.match(/^(\d+)\.\.(\d+)$/);
            if (planMatch) {
                while (stack.length > 0 && stack[stack.length - 1].indent >= indentation) {
                    const prev = stack.pop();
                    if (prev.startLine < i - 1) {
                        foldingRanges.push(new vscode.FoldingRange(prev.startLine, i - 1));
                    }
                }
                stack.push({ startLine: i, indent: indentation });
                continue;
            }

            if (trimmedLine === '---') {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].trim() === '...') {
                        foldingRanges.push(new vscode.FoldingRange(i, j, vscode.FoldingRangeKind.Region));
                        break;
                    }
                }
            }
        }

        while (stack.length > 0) {
            const prev = stack.pop();
            if (prev.startLine < lines.length - 1) {
                foldingRanges.push(new vscode.FoldingRange(prev.startLine, lines.length - 1));
            }
        }

        return foldingRanges;
    }
}

/**
 * Parse TAP content and extract test results
 */
function parseTapContent(text) {
    const lines = text.split('\n');
    const tests = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match test results: "ok N - description" or "not ok N - description"
        const match = line.match(/^(\s*)(ok|not ok)\s+(\d+)(?:\s+-\s+(.*))?/);
        if (match) {
            const indent = match[1].length;
            const passed = match[2] === 'ok';
            const testNumber = parseInt(match[3], 10);
            const rest = match[4] || '';

            // Check for directives
            const hasTodo = /# TODO/i.test(line);
            const hasSkip = /# SKIP/i.test(line);

            // Extract description (remove directive comments)
            const description = rest.replace(/#.*$/, '').trim() || `Test ${testNumber}`;

            tests.push({
                line: i,
                indent,
                passed,
                testNumber,
                description,
                hasTodo,
                hasSkip,
                fullLine: line
            });
        }
    }

    return tests;
}

/**
 * TAP Test Provider
 * Shows test results in the Test Explorer
 */
class TapTestProvider {
    constructor() {
        this.controller = vscode.tests.createTestController('tapTests', 'TAP Tests');
        this.testItems = new Map();

        this.controller.resolveHandler = async (item) => {
            if (!item) {
                // Resolve root - find all TAP files
                await this.discoverAllTests();
            }
        };

        this.controller.refreshHandler = async () => {
            await this.discoverAllTests();
        };
    }

    async discoverAllTests() {
        // Clear existing items
        this.controller.items.replace([]);
        this.testItems.clear();

        // Find all open TAP documents
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId === 'tap') {
                await this.updateTestsForDocument(document);
            }
        }
    }

    async updateTestsForDocument(document) {
        const uri = document.uri;
        const fileName = uri.path.split('/').pop();

        // Create or get file-level test item
        let fileItem = this.controller.items.get(uri.toString());
        if (!fileItem) {
            fileItem = this.controller.createTestItem(uri.toString(), fileName, uri);
            this.controller.items.add(fileItem);
        }

        // Parse tests from document
        const tests = parseTapContent(document.getText());

        // Clear existing children
        fileItem.children.replace([]);

        // Create test run to show results
        const run = this.controller.createTestRun(
            new vscode.TestRunRequest([fileItem]),
            'TAP Results',
            false
        );

        // Add test items and set their state
        for (const test of tests) {
            const testId = `${uri.toString()}#${test.testNumber}`;
            const testItem = this.controller.createTestItem(
                testId,
                `${test.testNumber}: ${test.description}`,
                uri
            );
            testItem.range = new vscode.Range(
                new vscode.Position(test.line, test.indent),
                new vscode.Position(test.line, test.fullLine.length)
            );

            fileItem.children.add(testItem);
            this.testItems.set(testId, testItem);

            // Set test state
            if (test.hasSkip) {
                run.skipped(testItem);
            } else if (test.hasTodo) {
                // TODO tests that fail are expected, treat as skipped
                if (test.passed) {
                    run.passed(testItem);
                } else {
                    run.skipped(testItem);
                }
            } else if (test.passed) {
                run.passed(testItem);
            } else {
                run.failed(testItem, new vscode.TestMessage(`Test failed: ${test.description}`));
            }
        }

        run.end();
    }

    removeTestsForDocument(uri) {
        this.controller.items.delete(uri.toString());
    }

    dispose() {
        this.controller.dispose();
    }
}

/**
 * Activates the extension
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Register folding provider
    const foldingProvider = new TapFoldingProvider();
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'tap' },
            foldingProvider
        )
    );

    // Register test provider
    const testProvider = new TapTestProvider();
    context.subscriptions.push(testProvider);

    // Update tests when document opens
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'tap') {
                testProvider.updateTestsForDocument(document);
            }
        })
    );

    // Update tests when document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'tap') {
                testProvider.updateTestsForDocument(event.document);
            }
        })
    );

    // Remove tests when document closes
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (document.languageId === 'tap') {
                testProvider.removeTestsForDocument(document.uri);
            }
        })
    );

    // Update tests for already open documents
    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'tap') {
            testProvider.updateTestsForDocument(document);
        }
    }
}

/**
 * Deactivates the extension
 */
function deactivate() {}

module.exports = {
    activate,
    deactivate
};
